// Browser-side store for the prototype order flow. The signed-in account, orders, portfolio list and profile edits live
// in localStorage; uploaded files are kept byte-for-byte in IndexedDB (localStorage is too small for full-size files).
// The real version needs server-side accounts and file storage.
import { artists, rupiah, type Art, type Artist, type Category } from '../data/artists';

const KEY_SESSION = 'rt_session', KEY_ORDERS = 'rt_orders', KEY_WORKS = 'rt_works', KEY_PROFILES = 'rt_profiles';

export type Session = { email: string; role: 'customer' } | { email: string; role: 'artist'; artist: string };
export interface ArtMeta { name: string; type: string; size: number; at: number }
export interface Order { id: string; email: string; artist: string; at: number; art: ArtMeta | null; deal: boolean; claimed: boolean }
/** A portfolio piece an illustrator uploaded from their dashboard. */
export interface Work extends ArtMeta { id: string; artist: string }

const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };

/** What an illustrator changed from their dashboard; anything left out keeps the value from src/data/artists.ts. */
export interface ProfileEdit {
  name?: string; city?: string; bio?: string; categories?: Category[]; priceFrom?: number; whatsapp?: string;
  photo?: number;           // `at` of the uploaded profile photo; absent = the default illustrated avatar
  removedSeeds?: string[];  // starter gallery tiles the artist removed
}
export type ArtistView = Artist & { photo?: number };

const profiles = (): Record<string, ProfileEdit> => read(KEY_PROFILES) ?? {};

/** The artist as this browser sees them: the seed data with the artist's own edits applied. */
export function artistBy(slug: string): ArtistView | undefined {
  const base = artists.find((a) => a.slug === slug);
  if (!base) return undefined;
  const { removedSeeds = [], ...edit } = profiles()[slug] ?? {};
  return { ...base, ...edit, gallery: base.gallery.filter((g) => !removedSeeds.includes(g)) };
}

export function loadSession(): Session | null {
  const s = read(KEY_SESSION);
  if (!s || (s.role !== 'customer' && !(s.role === 'artist' && artistBy(s.artist)))) return null;
  return s;
}

export function saveSession(s: Session | null) {
  try { s ? localStorage.setItem(KEY_SESSION, JSON.stringify(s)) : localStorage.removeItem(KEY_SESSION); } catch {}
  dispatchEvent(new CustomEvent('rt:session'));
}

export const loadOrders = (): Order[] => (read(KEY_ORDERS) ?? [])
  .filter((o: Order) => artistBy(o.artist))
  .map((o: Order) => (o.art && typeof o.art !== 'object' ? { ...o, art: null } : o)); // drop art saved by the older data-URL format

/** False when browser storage is full or blocked. */
export function saveOrders(orders: Order[]) {
  try { localStorage.setItem(KEY_ORDERS, JSON.stringify(orders)); return true; } catch { return false; }
}

/** Runs on sign-in/out in this tab and on any change made in another tab. */
export function onStoreChange(cb: () => void) {
  addEventListener('rt:session', cb);
  addEventListener('storage', (e) => { if (e.key === null || [KEY_SESSION, KEY_ORDERS, KEY_WORKS, KEY_PROFILES].includes(e.key)) cb(); });
}

/** Shows the `[data-view]` blocks listing the signed-in role ('guest' when signed out); a block may list several, space-separated. */
export function showView(root: HTMLElement, s: Session | null) {
  root.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => { v.hidden = !v.dataset.view!.split(' ').includes(s?.role ?? 'guest'); });
}

export interface LoginRequest { role?: 'customer' | 'artist'; note?: string; then?: (s: Session) => void }

/** Opens the header's login dialog; `then` runs right after a successful sign-in, still inside the click (so it may open a tab). */
export const requestLogin = (req: LoginRequest) => dispatchEvent(new CustomEvent<LoginRequest>('rt:login', { detail: req }));

// ---- files (IndexedDB: order art keyed by order id, portfolio works by `work:<id>`, photos by `photo:<slug>`) ----

const ART_EXT = ['jpg', 'jpeg', 'png', 'svg'];
const ART_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml'];
export const ART_ACCEPT = '.jpg,.jpeg,.png,.svg,' + ART_TYPES.join(',');

/** JPG, PNG or SVG only; some systems report no MIME type for SVG, so the extension decides when type is empty. */
export function isAllowedArt(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return ART_EXT.includes(ext) && (f.type === '' || ART_TYPES.includes(f.type));
}

let dbp: Promise<IDBDatabase> | undefined;
const idb = () => (dbp ??= new Promise((resolve, reject) => {
  const r = indexedDB.open('rupatinta', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('art');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
}));
const files = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction('art', mode).objectStore('art'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/** Stores the file exactly as uploaded and returns its metadata. */
async function putFile(key: string, file: File): Promise<ArtMeta> {
  await files('readwrite', (s) => s.put(file, key));
  return { name: file.name, type: file.type || 'image/svg+xml', size: file.size, at: Date.now() };
}

const urls = new Map<string, { at: number; url: string }>();

/** Object URLs by key (null when the file is missing), cached until the file's `at` changes. */
async function fileUrls(items: { key: string; at: number }[]) {
  const out = new Map<string, string | null>();
  await Promise.all(items.map(async ({ key, at }) => {
    const hit = urls.get(key);
    if (hit?.at === at) return out.set(key, hit.url);
    const blob = await files<Blob | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
    if (hit) URL.revokeObjectURL(hit.url);
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url) urls.set(key, { at, url });
    out.set(key, url);
  }));
  return out;
}

export const putArt = (orderId: string, file: File) => putFile(orderId, file);

/** Object URLs for each order's art, keyed by order id (null when there is none or the file is missing). */
export async function artUrls(list: Order[]) {
  const found = await fileUrls(list.flatMap((o) => (o.art ? [{ key: o.id, at: o.art.at }] : [])));
  return new Map(list.map((o) => [o.id, found.get(o.id) ?? null]));
}

// ---- portfolio works ----

const workKey = (id: string) => `work:${id}`;

/** One artist's uploaded works, newest first. */
export const loadWorks = (artist: string): Work[] =>
  ((read(KEY_WORKS) ?? []) as Work[]).filter((w) => w.artist === artist).sort((x, y) => y.at - x.at);

function saveWorks(update: (all: Work[]) => Work[]) {
  localStorage.setItem(KEY_WORKS, JSON.stringify(update(read(KEY_WORKS) ?? [])));
}

export async function addWork(artist: string, file: File): Promise<Work> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const work = { id, artist, ...(await putFile(workKey(id), file)) };
  try { saveWorks((all) => [...all, work]); }
  catch (e) { await files('readwrite', (s) => s.delete(workKey(id))); throw e; }
  return work;
}

export async function deleteWork(id: string) {
  saveWorks((all) => all.filter((w) => w.id !== id));
  await files('readwrite', (s) => s.delete(workKey(id))).catch(() => {});
}

/** Object URLs for works, keyed by work id. */
export async function workUrls(list: Work[]) {
  const found = await fileUrls(list.map((w) => ({ key: workKey(w.id), at: w.at })));
  return new Map(list.map((w) => [w.id, found.get(workKey(w.id)) ?? null]));
}

// ---- profile edits ----

const photoKey = (slug: string) => `photo:${slug}`;

/**
 * Merges `edit` into the artist's saved changes. `photo`: a File replaces the profile photo, null goes back to the
 * default avatar, undefined leaves it alone.
 */
export async function saveProfile(slug: string, edit: Omit<ProfileEdit, 'photo'>, photo?: File | null) {
  const all = profiles(), next: ProfileEdit = { ...all[slug], ...edit };
  if (photo) next.photo = (await putFile(photoKey(slug), photo)).at;
  else if (photo === null) { delete next.photo; await files('readwrite', (s) => s.delete(photoKey(slug))).catch(() => {}); }
  localStorage.setItem(KEY_PROFILES, JSON.stringify({ ...all, [slug]: next }));
  dispatchEvent(new CustomEvent('rt:profile'));
}

export function removeSeed(slug: string, art: string) {
  const all = profiles(), mine = all[slug] ?? {};
  const removedSeeds = [...new Set([...(mine.removedSeeds ?? []), art])];
  localStorage.setItem(KEY_PROFILES, JSON.stringify({ ...all, [slug]: { ...mine, removedSeeds } }));
  dispatchEvent(new CustomEvent('rt:profile'));
}

export async function photoUrl(a: ArtistView) {
  return a.photo ? (await fileUrls([{ key: photoKey(a.slug), at: a.photo }])).get(photoKey(a.slug)) ?? null : null;
}

/** Shows the profile photo on an `.avatar` element, or the default illustrated avatar when there is none. */
export function paintAvatar(el: HTMLElement, a: ArtistView, url: string | null) {
  el.classList.remove('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8');
  el.classList.toggle('photo', !!url);
  if (url) el.style.backgroundImage = `url("${url}")`;
  else { el.style.backgroundImage = ''; el.classList.add(a.avatar); }
}

/**
 * Applies artists' edits to server-rendered markup: any element with `data-artist-slug`, and inside it
 * `data-pf="name|city|bio|price|cats|avatar"` fields and `data-seed` gallery tiles.
 */
export async function applyProfiles(root: ParentNode = document) {
  await Promise.all([...root.querySelectorAll<HTMLElement>('[data-artist-slug]')].map(async (el) => {
    const a = artistBy(el.dataset.artistSlug!);
    if (!a) return;
    const field = (k: string) => el.querySelectorAll<HTMLElement>(`[data-pf="${k}"]`);
    field('name').forEach((f) => { f.textContent = a.name; });
    field('city').forEach((f) => { f.textContent = a.city; });
    field('bio').forEach((f) => { f.textContent = a.bio; });
    field('price').forEach((f) => { f.textContent = rupiah(a.priceFrom); });
    field('cats').forEach((f) => { f.innerHTML = a.categories.map((c) => `<span class="tag cat">${esc(c)}</span>`).join(' '); });
    if (el.dataset.categories !== undefined) el.dataset.categories = a.categories.join('|'); // homepage category filter
    el.querySelectorAll<HTMLElement>('[data-seed]').forEach((t) => { t.hidden = !a.gallery.includes(t.dataset.seed as Art); });
    const url = await photoUrl(a);
    field('avatar').forEach((f) => paintAvatar(f, a, url));
  }));
}

/** Runs when an illustrator saves profile changes, here or in another tab. */
export function onProfileChange(cb: () => void) {
  addEventListener('rt:profile', cb);
  addEventListener('storage', (e) => { if (e.key === KEY_PROFILES || e.key === null) cb(); });
}

// ---- shared rendering helpers ----

export type StateKey = 'talk' | 'locked' | 'ready' | 'claimed';

// Art is claimable only once the artist has uploaded it and marked the deal done.
export function stateOf(o: Order): { key: StateKey; label: string; cls: string } {
  if (o.claimed) return { key: 'claimed', label: 'Sudah diklaim', cls: 'st-open' };
  if (o.art && o.deal) return { key: 'ready', label: 'Siap diklaim', cls: 'st-open' };
  if (o.art) return { key: 'locked', label: 'Karya terkunci', cls: 'st-few' };
  return { key: 'talk', label: o.deal ? 'Deal selesai' : 'Sedang dibahas', cls: 'st-prog' };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const day = (t: number) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
export const fileSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
export const waLink = (a: Artist, email: string) =>
  `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(`Halo ${a.name}, saya ${email} dari RupaTinta. Saya mau pesan komisi.`)}`;

export function thumb(o: Order, url: string | null | undefined, locked: boolean) {
  const a = artistBy(o.artist)!;
  if (!url) return `<div class="od-thumb"><div class="avatar ${a.avatar}"></div></div>`;
  return `<div class="od-thumb${locked ? ' locked' : ''}"><img src="${url}" alt="${locked ? '' : 'Karya dari ' + esc(a.name)}" />${locked ? '<div class="wm">TERKUNCI</div>' : ''}</div>`;
}

/** A status line that clears itself. */
export function flasher(el: HTMLElement) {
  let timer: ReturnType<typeof setTimeout>;
  return (text: string) => {
    el.textContent = text; el.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => { el.hidden = true; }, 6000);
  };
}

// Browser-side store for the whole site: there is no server or database. The illustrator session, orders, slot
// settings, portfolio list and profile edits live in localStorage; uploaded files are kept byte-for-byte in IndexedDB
// (localStorage is too small for full-size files). Everything is per browser.
import { accounts } from '../data/accounts';
import { artists, rupiah, type Art, type Artist, type Category } from '../data/artists';

const KEY_SESSION = 'rt_session', KEY_ORDERS = 'rt_orders', KEY_WORKS = 'rt_works', KEY_PROFILES = 'rt_profiles', KEY_MINE = 'rt_mine';

/** Only illustrators sign in; customers order with a code instead of an account. */
export interface Session { email: string; artist: string }
export interface ArtMeta { name: string; type: string; size: number; at: number }

export const STATUSES = ['Menunggu', 'Dikerjakan', 'Selesai', 'Dibatalkan'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_PILL: Record<Status, string> = { Menunggu: 'st-few', Dikerjakan: 'st-prog', Selesai: 'st-open', Dibatalkan: 'st-full' };

export interface Order {
  code: string; artist: string; period: string; at: number;
  name: string; whatsapp: string; type: string; brief: string;
  status: Status;
  art: ArtMeta | null;   // the finished file; the customer can claim it once status is Selesai
  claimed: boolean;
}
/** A portfolio piece an illustrator uploaded from their dashboard. */
export interface Work extends ArtMeta { id: string; artist: string }
export interface Slots { period: string; total: number }

const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };

/** What an illustrator changed from their dashboard; anything left out keeps the value from src/data/artists.ts. */
export interface ProfileEdit {
  name?: string; city?: string; bio?: string; categories?: Category[]; priceFrom?: number; whatsapp?: string;
  slots?: Slots;            // absent = closed (0 slots) for the current month
  photo?: number;           // `at` of the uploaded profile photo; absent = the default illustrated avatar
  removedSeeds?: string[];  // starter gallery tiles the artist removed
}
export type ArtistView = Artist & { photo?: number; slots: Slots };

const profiles = (): Record<string, ProfileEdit> => read(KEY_PROFILES) ?? {};
const thisMonth = () => new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(Date.now());

/** The artist as this browser sees them: the seed data with the artist's own edits applied. */
export function artistBy(slug: string): ArtistView | undefined {
  const base = artists.find((a) => a.slug === slug);
  if (!base) return undefined;
  const { removedSeeds = [], slots = { period: thisMonth(), total: 0 }, ...edit } = profiles()[slug] ?? {};
  return { ...base, ...edit, slots, gallery: base.gallery.filter((g) => !removedSeeds.includes(g)) };
}

// ---- illustrator session ----

/** The account for this email and password (see src/data/accounts.ts), or null. */
export function signIn(email: string, password: string): Session | null {
  const acc = accounts.find((a) => a.email === email.trim().toLowerCase() && a.password === password);
  return acc ? { email: acc.email, artist: acc.artist } : null;
}

export function loadSession(): Session | null {
  const s = read(KEY_SESSION);
  // Sessions from older builds (dummy emails, customer role) are not accounts any more.
  return s && accounts.some((a) => a.email === s.email && a.artist === s.artist) && artistBy(s.artist) ? s : null;
}

export function saveSession(s: Session | null) {
  try { s ? localStorage.setItem(KEY_SESSION, JSON.stringify(s)) : localStorage.removeItem(KEY_SESSION); } catch {}
  dispatchEvent(new CustomEvent('rt:session'));
}

/** Runs on sign-in/out and order changes in this tab, and on any change made in another tab. */
export function onStoreChange(cb: () => void) {
  addEventListener('rt:session', cb);
  addEventListener('rt:orders', cb);
  addEventListener('storage', (e) => { if (e.key === null || [KEY_SESSION, KEY_ORDERS, KEY_WORKS, KEY_PROFILES].includes(e.key)) cb(); });
}

/** Shows the `[data-view]` blocks for 'artist' (signed in) or 'guest'. */
export function showView(root: HTMLElement, s: Session | null) {
  root.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== (s ? 'artist' : 'guest'); });
}

// ---- orders, slots and queue ----

// Orders saved by older builds have no code; they belonged to the removed customer accounts.
export const loadOrders = (): Order[] => ((read(KEY_ORDERS) ?? []) as Order[]).filter((o) => o.code && artistBy(o.artist));

/** False when browser storage is full or blocked. */
export function saveOrders(orders: Order[]) {
  try { localStorage.setItem(KEY_ORDERS, JSON.stringify(orders)); } catch { return false; }
  dispatchEvent(new CustomEvent('rt:orders'));
  return true;
}

export const findOrder = (code: string) => loadOrders().find((o) => o.code === code.trim().toUpperCase());

/** Orders placed from this browser, newest first (what "Cek pesanan" lists without a code). */
export const myOrders = () => {
  const codes: string[] = read(KEY_MINE) ?? [];
  return loadOrders().filter((o) => codes.includes(o.code)).sort((x, y) => y.at - x.at);
};

/** Orders holding a slot in the artist's current period, in queue order. Cancelling frees the slot. */
export const queueOf = (a: ArtistView) =>
  loadOrders().filter((o) => o.artist === a.slug && o.period === a.slots.period && o.status !== 'Dibatalkan').sort((x, y) => x.at - y.at);

export const remaining = (a: ArtistView, filled = queueOf(a).length) => Math.max(0, a.slots.total - filled);

export function slotBadge(a: ArtistView, filled = queueOf(a).length) {
  if (a.slots.total <= 0) return { label: 'Slot tutup', cls: 'st-full' };
  const n = remaining(a, filled);
  if (n <= 0) return { label: 'Penuh', cls: 'st-full' };
  return { label: `${n} slot`, cls: n <= 2 ? 'st-few' : 'st-open' };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const newCode = () => 'RT-' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

export type CreateResult = { ok: true; code: string } | { ok: false; reason: 'closed' | 'full' | 'duplicate' | 'storage' };

/** Takes a slot in the artist's current period straight away. */
export function createOrder(slug: string, input: Pick<Order, 'name' | 'whatsapp' | 'type' | 'brief'>): CreateResult {
  const a = artistBy(slug)!, queue = queueOf(a);
  if (a.slots.total <= 0) return { ok: false, reason: 'closed' };
  if (queue.some((o) => o.whatsapp === input.whatsapp)) return { ok: false, reason: 'duplicate' };
  if (queue.length >= a.slots.total) return { ok: false, reason: 'full' };
  const all = loadOrders();
  let code = newCode();
  while (all.some((o) => o.code === code)) code = newCode();
  const order: Order = { code, artist: slug, period: a.slots.period, at: Date.now(), ...input, status: 'Menunggu', art: null, claimed: false };
  if (!saveOrders([...all, order])) return { ok: false, reason: 'storage' };
  try { localStorage.setItem(KEY_MINE, JSON.stringify([...(read(KEY_MINE) ?? []), code])); } catch {}
  return { ok: true, code };
}

export interface QueueRow { position: number; code: string; client: string; type: string; status: Status }
export const queueRows = (a: ArtistView): QueueRow[] =>
  queueOf(a).map((o, i) => ({ position: i + 1, code: o.code, client: maskName(o.name), type: o.type, status: o.status }));

/** The public queue table; the visitor's own order (`highlight`) shows as "Kamu". */
export function queueTable(rows: QueueRow[], title = 'Antrian saat ini', highlight?: string) {
  const body = rows.length === 0
    ? '<p class="q-empty">Belum ada antrian. Pesanan pertama langsung dapat nomor #1.</p>'
    : `<div class="q" role="table" aria-label="${esc(title)}">
        <div class="qh" role="row"><span role="columnheader">No</span><span role="columnheader">Klien</span><span role="columnheader">Jenis</span><span role="columnheader">Status</span></div>
        ${rows.map((q) => `<div class="qr${q.code === highlight ? ' me' : ''}" role="row"><span role="cell">#${q.position}</span><span role="cell">${q.code === highlight ? 'Kamu' : esc(q.client)}</span><span role="cell">${esc(q.type)}</span><span role="cell"><span class="prog ${STATUS_PILL[q.status]}">${q.status}</span></span></div>`).join('')}
      </div>`;
  return `<div class="card"><h3 class="qt">${esc(title)}</h3>${body}</div>`;
}

// "Rara Ayu" -> "ra***u", the masking style used in public queues.
export function maskName(name: string) {
  const n = name.trim().toLowerCase().replace(/\s+/g, '');
  if (n.length <= 2) return (n[0] ?? '') + '***';
  return n.slice(0, 2) + '***' + n.slice(-1);
}

// 0812•••••789: enough for customers to recognise their own number.
export const maskWhatsapp = (wa: string) => '0' + wa.slice(2, 5) + '•'.repeat(Math.max(0, wa.length - 8)) + wa.slice(-3);

// ---- files (IndexedDB: order art keyed by order code, portfolio works by `work:<id>`, photos by `photo:<slug>`) ----

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

export const putArt = (code: string, file: File) => putFile(code, file);

/** Object URLs for each order's art, keyed by order code (null when there is none or the file is missing). */
export async function artUrls(list: Order[]) {
  const found = await fileUrls(list.flatMap((o) => (o.art ? [{ key: o.code, at: o.art.at }] : [])));
  return new Map(list.map((o) => [o.code, found.get(o.code) ?? null]));
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
 * Applies artists' edits and live slot counts to the static markup: any element with `data-artist-slug`, and inside
 * it `data-pf="name|city|bio|price|cats|avatar|slot|bar"` fields and `data-seed` gallery tiles.
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
    const filled = queueOf(a).length, badge = slotBadge(a, filled);
    field('slot').forEach((f) => { f.className = `tag ${badge.cls}`; f.textContent = badge.label; f.hidden = false; });
    field('bar').forEach((f) => {
      const i = f.querySelector('i')!;
      i.style.width = `${a.slots.total ? Math.round((Math.min(filled, a.slots.total) / a.slots.total) * 100) : 0}%`;
      i.classList.toggle('full', badge.cls === 'st-full');
      f.hidden = a.slots.total <= 0;
    });
    if (el.dataset.categories !== undefined) el.dataset.categories = a.categories.join('|'); // homepage category filter
    el.querySelectorAll<HTMLElement>('[data-seed]').forEach((t) => { t.hidden = !a.gallery.includes(t.dataset.seed as Art); });
    const url = await photoUrl(a);
    field('avatar').forEach((f) => paintAvatar(f, a, url));
  }));
}

/** Runs when an illustrator saves profile or slot changes, here or in another tab. */
export function onProfileChange(cb: () => void) {
  addEventListener('rt:profile', cb);
  addEventListener('storage', (e) => { if (e.key === KEY_PROFILES || e.key === null) cb(); });
}

// ---- shared rendering helpers ----

export type StateKey = 'none' | 'locked' | 'ready' | 'claimed';

// The finished file is claimable only once the artist has uploaded it and set the order to Selesai (deal done).
export function stateOf(o: Order): { key: StateKey; label: string; cls: string } {
  if (o.claimed) return { key: 'claimed', label: 'Sudah diklaim', cls: 'st-open' };
  if (o.art && o.status === 'Selesai') return { key: 'ready', label: 'Siap diklaim', cls: 'st-open' };
  if (o.art) return { key: 'locked', label: 'Karya terkunci', cls: 'st-few' };
  return { key: 'none', label: 'Belum ada file', cls: 'st-prog' };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const day = (t: number) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
export const fileSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;

/** Customer → artist chat; mentions the order code when there is one. */
export const waLink = (a: Artist, code?: string) =>
  `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(code
    ? `Halo ${a.name}, saya memesan lewat RupaTinta dengan kode ${code}. Mau membahas detail komisinya.`
    : `Halo ${a.name}, saya lihat profilmu di RupaTinta dan mau tanya soal komisi.`)}`;

/** Artist → customer chat about an order. */
export const waCustomer = (a: Artist, o: Order) =>
  `https://wa.me/${o.whatsapp}?text=${encodeURIComponent(`Halo ${o.name}, ini ${a.name} dari RupaTinta soal pesanan ${o.code} (${o.type}).`)}`;

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

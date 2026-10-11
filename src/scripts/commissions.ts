// Data layer for the whole site, on Firebase (project rupatinta-komisi):
// - Auth: illustrator accounts (email + password). Customers have no account; they order with a code.
// - Firestore: artists/{uid} (public profile + slot counter), artists/{uid}/works (portfolio), orders/{code} (private,
//   readable by whoever has the code), queue/{code} (public, masked copy for queue tables).
// - Storage: artists/{uid}/photo|works/* (public), orders/{code}/* (readable once the order is Selesai).
// Access rules live in firebase/firestore.rules and firebase/storage.rules.
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import {
  collection, doc, getDoc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
  deleteDoc, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../lib/firebase';
import { normalizeWhatsapp } from '../lib/phone';
import { CATEGORIES, rupiah, type Category } from '../data/categories';

export { rupiah };

export const STATUSES = ['Menunggu', 'Dikerjakan', 'Selesai', 'Dibatalkan'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_PILL: Record<Status, string> = { Menunggu: 'st-few', Dikerjakan: 'st-prog', Selesai: 'st-open', Dibatalkan: 'st-full' };

/** `filled` counts orders holding a slot in `period`; customers' order transactions bump it and name the order in `lastCode`. */
export interface Slots { period: string; total: number; filled: number; lastCode?: string }
export interface Artist {
  id: string; name: string; city: string; bio: string; categories: Category[]; priceFrom: number;
  whatsapp: string;          // 62… for wa.me links
  photo: string | null; photoPath: string | null;
  covers: string[];          // latest portfolio images, shown on cards
  slots: Slots;
  listed: boolean;           // profile complete, shown on the site
}
export interface ArtMeta { path: string; name: string; type: string; size: number; at: number }
export interface Order {
  code: string; artist: string; period: string; at: number;
  name: string; whatsapp: string; type: string; brief: string;
  status: Status;
  art: ArtMeta | null;   // the finished file; the customer can claim it once status is Selesai
  claimed: boolean;
}
export interface Work extends ArtMeta { id: string; url: string }
export interface QueueRow { position: number; code: string; client: string; type: string; status: Status }

const millis = (t: unknown) => (t && typeof (t as { toMillis?: () => number }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : Date.now());
const thisMonth = () => new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(Date.now());

const toArtist = (id: string, d: DocumentData): Artist => ({
  id, name: d.name ?? '', city: d.city ?? '', bio: d.bio ?? '', categories: d.categories ?? [], priceFrom: d.priceFrom ?? 0,
  whatsapp: d.whatsapp ?? '', photo: d.photo ?? null, photoPath: d.photoPath ?? null,
  covers: d.covers ?? [], slots: d.slots ?? { period: thisMonth(), total: 0, filled: 0 }, listed: !!d.listed,
});
const toOrder = (code: string, d: DocumentData): Order => ({ ...(d as Order), code, at: millis(d.at) });

// ---- artists ----

/** Listed artists (complete profiles), live; newest profiles last. */
export function watchArtists(cb: (list: Artist[]) => void, onError?: () => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'artists'), where('listed', '==', true)),
    (s) => cb(s.docs.map((d) => toArtist(d.id, d.data())).sort((x, y) => x.name.localeCompare(y.name))), () => onError?.());
}

export function watchArtist(id: string, cb: (a: Artist | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'artists', id), (s) => cb(s.exists() ? toArtist(s.id, s.data()) : null), () => cb(null));
}

/** What a profile still needs before it is listed; empty when complete. */
export function missing(a: Pick<Artist, 'name' | 'city' | 'categories' | 'priceFrom' | 'whatsapp'>) {
  return [
    a.name.trim().length < 2 && 'nama',
    a.city.trim().length < 2 && 'kota',
    !a.categories.length && 'kategori',
    !(a.priceFrom >= 10000) && 'harga mulai',
    !normalizeWhatsapp(a.whatsapp) && 'nomor WhatsApp',
  ].filter(Boolean) as string[];
}

// ---- categories: the starting list plus any an illustrator added ----

const catId = (name: string) => name.trim().toLowerCase().replace(/&/g, 'dan').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** All category names, starting list first, then added ones A–Z. */
export function watchCategories(cb: (list: Category[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'categories'), (s) => {
    const added = s.docs.map((d) => String(d.data().name)).filter((n) => !CATEGORIES.some((c) => catId(c) === catId(n)));
    cb([...CATEGORIES, ...added.sort((x, y) => x.localeCompare(y, 'id'))]);
  }, () => cb([...CATEGORIES]));
}

/**
 * Saves a new category for everyone and returns its name. If it already exists (ignoring case and punctuation),
 * the existing name is returned instead, so "chibi" doesn't become a second "Chibi".
 */
export async function addCategory(name: string, known: Category[]): Promise<Category> {
  const clean = name.trim().replace(/\s+/g, ' ');
  const same = known.find((c) => catId(c) === catId(clean));
  if (same) return same;
  const ref_ = doc(db, 'categories', catId(clean));
  try {
    await setDoc(ref_, { name: clean, by: auth.currentUser!.uid, at: serverTimestamp() });
  } catch (e) {
    const s = await getDoc(ref_).catch(() => null); // someone added it a moment ago
    if (s?.exists()) return String(s.data().name);
    throw e;
  }
  return clean;
}
export const validCategory = (name: string) => name.trim().length >= 2 && name.trim().length <= 30 && catId(name).length >= 2;

// ---- illustrator accounts ----

export interface Me { uid: string; email: string; artist: Artist | null }

/** The signed-in illustrator and their live profile; null when signed out. */
export function watchMe(cb: (me: Me | null) => void): Unsubscribe {
  let stopDoc: Unsubscribe | undefined;
  const stopAuth = onAuthStateChanged(auth, (u) => {
    stopDoc?.(); stopDoc = undefined;
    if (!u) return cb(null);
    stopDoc = onSnapshot(doc(db, 'artists', u.uid), (s) => cb({ uid: u.uid, email: u.email ?? '', artist: s.exists() ? toArtist(s.id, s.data()) : null }),
      () => cb({ uid: u.uid, email: u.email ?? '', artist: null }));
  });
  return () => { stopDoc?.(); stopAuth(); };
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Email atau password salah.',
  'auth/invalid-email': 'Format email tidak valid.',
  'auth/user-disabled': 'Akun ini dinonaktifkan.',
  'auth/email-already-in-use': 'Email ini sudah terdaftar. Silakan masuk.',
  'auth/weak-password': 'Password minimal 6 karakter.',
  'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.',
  'auth/network-request-failed': 'Tidak ada koneksi internet.',
};
export const authMessage = (e: unknown) => AUTH_ERRORS[(e as { code?: string })?.code ?? ''] ?? 'Terjadi kesalahan. Coba lagi.';

export const signIn = (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);
export const signOut = () => fbSignOut(auth);

/** Creates the account and an unlisted profile; the illustrator completes it in their dashboard. */
export async function signUp(name: string, email: string, password: string) {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await setDoc(doc(db, 'artists', user.uid), {
    name: name.trim(), city: '', bio: '', categories: [], priceFrom: 0, whatsapp: '',
    photo: null, photoPath: null, covers: [], slots: { period: thisMonth(), total: 0, filled: 0 }, listed: false, createdAt: serverTimestamp(),
  });
}

export type ProfileEdit = Pick<Artist, 'name' | 'city' | 'bio' | 'categories' | 'priceFrom' | 'whatsapp'>;

/** Thrown when the profile text saved but the photo upload failed. */
export class PhotoError extends Error {}

/**
 * Saves the profile text first, then the photo, so a failed upload never loses the rest.
 * `photo`: a File replaces the profile photo, null goes back to initials, undefined leaves it alone.
 */
export async function saveProfile(a: Artist, edit: ProfileEdit, photo?: File | null) {
  const listed = missing(edit).length === 0;
  await updateDoc(doc(db, 'artists', a.id), { ...edit, listed, ...(photo === null ? { photo: null, photoPath: null } : {}) });
  if (photo === null && a.photoPath) deleteObject(ref(storage, a.photoPath)).catch(() => {});
  if (!photo) return;
  try {
    const path = `artists/${a.id}/photo/${Date.now()}-${safeName(photo.name)}`;
    await uploadBytes(ref(storage, path), photo, { contentType: contentType(photo) });
    await updateDoc(doc(db, 'artists', a.id), { photo: await getDownloadURL(ref(storage, path)), photoPath: path });
    if (a.photoPath) deleteObject(ref(storage, a.photoPath)).catch(() => {});
  } catch (e) {
    console.error('photo upload failed', e);
    throw new PhotoError();
  }
}

const holds = (o: Order, period: string) => o.period === period && o.status !== 'Dibatalkan';

/** Opens/closes slots. `filled` is recounted from the artist's orders, so a new period starts empty. */
export function saveSlots(a: Artist, period: string, total: number, orders: Order[]) {
  return updateDoc(doc(db, 'artists', a.id), { slots: { period, total, filled: orders.filter((o) => holds(o, period)).length } });
}

// ---- orders, queue ----

/** The illustrator's orders, live. */
export function watchArtistOrders(uid: string, cb: (list: Order[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'orders'), where('artist', '==', uid)), (s) => cb(s.docs.map((d) => toOrder(d.id, d.data()))));
}

export function watchOrder(code: string, cb: (o: Order | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'orders', code), (s) => cb(s.exists() ? toOrder(s.id, s.data()) : null), () => cb(null));
}
export const getOrder = async (code: string) => {
  const s = await getDoc(doc(db, 'orders', code)).catch(() => null);
  return s?.exists() ? toOrder(s.id, s.data()) : null;
};

/** Public queue for the artist's current period, oldest first. */
export function watchQueue(a: Artist, cb: (rows: QueueRow[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'queue'), where('artist', '==', a.id), where('period', '==', a.slots.period)), (s) => {
    const live = s.docs.map((d) => ({ code: d.id, ...d.data(), at: millis(d.data().at) }) as { code: string; client: string; type: string; status: Status; at: number })
      .filter((q) => q.status !== 'Dibatalkan').sort((x, y) => x.at - y.at);
    cb(live.map((q, i) => ({ position: i + 1, code: q.code, client: q.client, type: q.type, status: q.status })));
  }, () => cb([]));
}

/** Changes an order's status; the slot counter follows (cancelling frees the slot). */
export async function setStatus(a: Artist, o: Order, status: Status, orders: Order[]) {
  const b = writeBatch(db);
  b.update(doc(db, 'orders', o.code), { status });
  b.update(doc(db, 'queue', o.code), { status });
  const after = orders.map((x) => (x.code === o.code ? { ...x, status } : x));
  b.update(doc(db, 'artists', a.id), { 'slots.filled': after.filter((x) => holds(x, a.slots.period)).length });
  await b.commit();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const newCode = () => 'RT-' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

export type CreateResult = { ok: true; code: string } | { ok: false; reason: 'closed' | 'full' | 'error' };

/** Takes a slot in the artist's current period. A transaction keeps two customers from getting the last slot. */
export async function createOrder(artistId: string, input: Pick<Order, 'name' | 'whatsapp' | 'type' | 'brief'>): Promise<CreateResult> {
  const code = newCode();
  try {
    const res = await runTransaction(db, async (tx) => {
      const aref = doc(db, 'artists', artistId), s = await tx.get(aref);
      if (!s.exists()) return 'closed' as const;
      const a = toArtist(s.id, s.data());
      if (!a.listed || a.slots.total <= 0) return 'closed' as const;
      if (a.slots.filled >= a.slots.total) return 'full' as const;
      tx.set(doc(db, 'orders', code), { artist: artistId, period: a.slots.period, at: serverTimestamp(), ...input, status: 'Menunggu', art: null, claimed: false });
      tx.set(doc(db, 'queue', code), { artist: artistId, period: a.slots.period, at: serverTimestamp(), client: maskName(input.name), type: input.type, status: 'Menunggu' });
      tx.update(aref, { 'slots.filled': a.slots.filled + 1, 'slots.lastCode': code });
      return 'ok' as const;
    });
    if (res !== 'ok') return { ok: false, reason: res };
  } catch (e) {
    console.error('createOrder failed', e);
    return { ok: false, reason: 'error' };
  }
  rememberOrder(code);
  return { ok: true, code };
}

export const claimOrder = (code: string) => updateDoc(doc(db, 'orders', code), { claimed: true });

// Codes of orders placed from this browser, so "Cek pesanan" can list them without an account.
const KEY_MINE = 'rt_mine';
export const myCodes = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY_MINE) ?? '[]'); } catch { return []; } };
function rememberOrder(code: string) {
  try { localStorage.setItem(KEY_MINE, JSON.stringify([...myCodes().filter((c) => c !== code), code])); } catch {}
}

// "Rara Ayu" -> "ra***u", the masking style used in public queues.
export function maskName(name: string) {
  const n = name.trim().toLowerCase().replace(/\s+/g, '');
  if (n.length <= 2) return (n[0] ?? '') + '***';
  return n.slice(0, 2) + '***' + n.slice(-1);
}

// 0812•••••789: enough for customers to recognise their own number.
export const maskWhatsapp = (wa: string) => '0' + wa.slice(2, 5) + '•'.repeat(Math.max(0, wa.length - 8)) + wa.slice(-3);

export const remaining = (a: Artist) => Math.max(0, a.slots.total - a.slots.filled);
export function slotBadge(a: Artist) {
  if (a.slots.total <= 0) return { label: 'Slot tutup', cls: 'st-full' };
  const n = remaining(a);
  if (n <= 0) return { label: 'Penuh', cls: 'st-full' };
  return { label: `${n} slot`, cls: n <= 2 ? 'st-few' : 'st-open' };
}

// ---- files: stored exactly as uploaded (no resizing or re-encoding) ----

const ART_EXT = ['jpg', 'jpeg', 'png', 'svg'];
const ART_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml'];
export const ART_ACCEPT = '.jpg,.jpeg,.png,.svg,' + ART_TYPES.join(',');

/** JPG, PNG or SVG only; some systems report no MIME type for SVG, so the extension decides when type is empty. */
export function isAllowedArt(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return ART_EXT.includes(ext) && (f.type === '' || ART_TYPES.includes(f.type));
}
const contentType = (f: File) => f.type || { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[f.name.split('.').pop()!.toLowerCase()] || 'image/svg+xml';
const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_').slice(-80);

/** Uploads the finished file for an order. It downloads under its original name once the customer claims it. */
export async function uploadOrderArt(o: Order, file: File) {
  const path = `orders/${o.code}/${Date.now()}-${safeName(file.name)}`;
  await uploadBytes(ref(storage, path), file, {
    contentType: contentType(file),
    contentDisposition: `attachment; filename="${file.name.replace(/["\\\r\n]/g, '_')}"`,
  });
  const art: ArtMeta = { path, name: file.name, type: contentType(file), size: file.size, at: Date.now() };
  await updateDoc(doc(db, 'orders', o.code), { art });
  if (o.art) deleteObject(ref(storage, o.art.path)).catch(() => {});
  return art;
}

/** Download URL for an order's file, or null while it is locked (storage rules refuse it) or missing. */
export const orderArtUrl = (o: Order) => (o.art ? getDownloadURL(ref(storage, o.art.path)).catch(() => null) : Promise.resolve(null));

export function watchWorks(uid: string, cb: (list: Work[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'artists', uid, 'works'), orderBy('at', 'desc')),
    (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<Work, 'id'>), id: d.id }))), () => cb([]));
}

export async function addWork(uid: string, file: File) {
  const path = `artists/${uid}/works/${Date.now()}-${safeName(file.name)}`;
  await uploadBytes(ref(storage, path), file, { contentType: contentType(file) });
  const work = { path, url: await getDownloadURL(ref(storage, path)), name: file.name, type: contentType(file), size: file.size, at: Date.now() };
  const d = doc(collection(db, 'artists', uid, 'works'));
  await setDoc(d, work);
  return { ...work, id: d.id };
}

export async function deleteWork(uid: string, w: Work) {
  await deleteDoc(doc(db, 'artists', uid, 'works', w.id));
  await deleteObject(ref(storage, w.path)).catch(() => {});
}

/** Cards show the three latest works; kept on the artist doc so listing pages need one read per artist. */
export function syncCovers(a: Artist, works: Work[]) {
  const covers = works.slice(0, 3).map((w) => w.url);
  if (covers.join() === a.covers.join()) return;
  return updateDoc(doc(db, 'artists', a.id), { covers }).catch(() => {});
}

// ---- rendering helpers ----

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

/** Profile photo, or the artist's initial when there is none. */
export function avatar(a: Pick<Artist, 'name' | 'photo'>, size = '') {
  return a.photo
    ? `<div class="avatar photo ${size}" style="background-image:url('${esc(a.photo)}')"></div>`
    : `<div class="avatar ini ${size}" aria-hidden="true">${esc((a.name.trim()[0] ?? '?').toUpperCase())}</div>`;
}
export function paintAvatar(el: HTMLElement, a: Pick<Artist, 'name' | 'photo'>, url = a.photo) {
  el.classList.toggle('photo', !!url);
  el.classList.toggle('ini', !url);
  el.style.backgroundImage = url ? `url("${url}")` : '';
  el.textContent = url ? '' : (a.name.trim()[0] ?? '?').toUpperCase();
}

/** Card cover: the artist's latest works, or an empty frame. */
export const cover = (a: Artist) =>
  `<div class="cover${a.covers.length ? '' : ' empty'}" aria-hidden="true">${[0, 1, 2].map((i) => (a.covers[i] ? `<div><img src="${esc(a.covers[i])}" alt="" loading="lazy" /></div>` : '<div></div>')).join('')}</div>`;

export function slotTag(a: Artist) {
  const b = slotBadge(a);
  return `<span class="tag ${b.cls}">${b.label}</span>`;
}

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

/** Customer → artist chat; mentions the order code when there is one. */
export const waLink = (a: Artist, code?: string) =>
  `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(code
    ? `Halo ${a.name}, saya memesan lewat RupaTinta dengan kode ${code}. Mau membahas detail komisinya.`
    : `Halo ${a.name}, saya lihat profilmu di RupaTinta dan mau tanya soal komisi.`)}`;

/** Artist → customer chat about an order. */
export const waCustomer = (a: Artist, o: Order) =>
  `https://wa.me/${o.whatsapp}?text=${encodeURIComponent(`Halo ${o.name}, ini ${a.name} dari RupaTinta soal pesanan ${o.code} (${o.type}).`)}`;

export const artistUrl = (a: Pick<Artist, 'id'>) => `/artist?id=${encodeURIComponent(a.id)}`;

/** A status line that clears itself; `sticky` keeps it up (e.g. while an upload runs) until the next message. */
export function flasher(el: HTMLElement) {
  let timer: ReturnType<typeof setTimeout>;
  return (text: string, sticky = false) => {
    el.textContent = text; el.hidden = false;
    clearTimeout(timer);
    if (!sticky) timer = setTimeout(() => { el.hidden = true; }, 6000);
  };
}

/** Why an upload failed, in words the illustrator can act on. */
export function uploadMessage(e: unknown) {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'storage/unauthorized') return 'File ditolak. Pastikan formatnya JPG, PNG, atau SVG dan ukurannya di bawah 50 MB.';
  if (code === 'storage/quota-exceeded') return 'Kuota penyimpanan habis.';
  return 'Upload gagal. Periksa koneksi internet, atau penyimpanan file Firebase belum aktif.';
}

/** Homepage card: links to the artist page. */
export function artistCard(a: Artist) {
  const b = slotBadge(a), pct = a.slots.total ? Math.round((Math.min(a.slots.filled, a.slots.total) / a.slots.total) * 100) : 0;
  return `<a class="acard" href="${artistUrl(a)}" data-categories="${esc(a.categories.join('|'))}">${cover(a)}
    <div class="body">
      <div class="row"><div class="who">${avatar(a, 'sm')}<div><b>${esc(a.name)}</b><span>${esc(a.city)}</span></div></div>${slotTag(a)}</div>
      ${a.slots.total ? `<div class="bar"><i class="${b.cls === 'st-full' ? 'full' : ''}" style="width:${pct}%"></i></div>` : ''}
      <div class="price">Mulai <b>${rupiah(a.priceFrom)}</b> · ${esc(a.categories[0] ?? '')}</div>
    </div></a>`;
}

/** /pesan card: order and WhatsApp actions. */
export function orderCard(a: Artist) {
  return `<article class="acard od-acard">${cover(a)}
    <div class="body">
      <div class="row"><div class="who">${avatar(a, 'sm')}<div><b>${esc(a.name)}</b><span>${esc(a.city)}</span></div></div>${slotTag(a)}</div>
      <div class="od-cats">${a.categories.map((c) => `<span class="tag cat">${esc(c)}</span>`).join('')}</div>
      <p class="od-price">Mulai <b>${rupiah(a.priceFrom)}</b> · ${esc(a.categories[0] ?? '')}</p>
      <a class="btn btn-pri btn-block" href="${artistUrl(a)}#pesan">Lihat portofolio &amp; pesan</a>
      <a class="od-profile" href="${waLink(a)}" target="_blank" rel="noopener">Tanya dulu di WhatsApp</a>
    </div></article>`;
}

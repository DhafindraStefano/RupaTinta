import { randomInt } from 'node:crypto';
import { db } from './db';
import type { Artist } from '../data/artists';

export const STATUSES = ['Menunggu', 'Dikerjakan', 'Selesai', 'Dibatalkan'] as const;
export type Status = (typeof STATUSES)[number];

export interface Reservation {
  id: number; code: string; artist_slug: string; period: string;
  customer_name: string; whatsapp: string; commission_type: string; brief: string;
  status: Status; created_at: Date;
}

export interface QueueRow { position: number; code: string; client: string; type: string; status: Status }

// A reservation holds a slot unless it was cancelled.
const HOLDS_SLOT = 'Dibatalkan';

// "Rara Ayu" -> "ra***u", the masking style used in public queues.
export function maskName(name: string) {
  const n = name.trim().toLowerCase().replace(/\s+/g, '');
  if (n.length <= 2) return (n[0] ?? '') + '***';
  return n.slice(0, 2) + '***' + n.slice(-1);
}

export { normalizeWhatsapp } from './phone'; // shared with the browser-side profile editor

// 0812•••••789 — enough for customers to recognise their own number.
export const maskWhatsapp = (wa: string) => '0' + wa.slice(2, 5) + '•'.repeat(Math.max(0, wa.length - 8)) + wa.slice(-3);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const newCode = () => 'RT-' + Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Filled slot count per artist for each artist's current period. */
export async function filledCounts(list: Artist[]) {
  const rows = await db()<{ artist_slug: string; period: string; n: number }[]>`
    SELECT artist_slug, period, count(*)::int AS n FROM reservations
    WHERE status <> ${HOLDS_SLOT} GROUP BY artist_slug, period`;
  return new Map(list.map((a) => [a.slug, rows.find((r) => r.artist_slug === a.slug && r.period === a.slots.period)?.n ?? 0]));
}

/** The public queue for an artist's current period, oldest first. */
export async function queueFor(artist: Artist): Promise<QueueRow[]> {
  const rows = await db()<Pick<Reservation, 'code' | 'customer_name' | 'commission_type' | 'status'>[]>`
    SELECT code, customer_name, commission_type, status FROM reservations
    WHERE artist_slug = ${artist.slug} AND period = ${artist.slots.period} AND status <> ${HOLDS_SLOT}
    ORDER BY created_at, id`;
  return rows.map((r, i) => ({ position: i + 1, code: r.code, client: maskName(r.customer_name), type: r.commission_type, status: r.status }));
}

export type CreateResult = { ok: true; code: string } | { ok: false; reason: 'full' | 'duplicate' };

/**
 * Takes a slot immediately. An advisory lock per artist+period serialises concurrent bookings,
 * so two customers can never both get the last slot.
 */
export async function createReservation(
  artist: Artist,
  input: { name: string; whatsapp: string; type: string; brief: string },
): Promise<CreateResult> {
  const { slug } = artist, { period, total } = artist.slots;
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${slug + ':' + period}))`;
    const [{ n, mine }] = await tx<{ n: number; mine: number }[]>`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE whatsapp = ${input.whatsapp})::int AS mine
      FROM reservations WHERE artist_slug = ${slug} AND period = ${period} AND status <> ${HOLDS_SLOT}`;
    if (mine > 0) return { ok: false, reason: 'duplicate' } as const;
    if (n >= total) return { ok: false, reason: 'full' } as const;
    const code = newCode();
    await tx`
      INSERT INTO reservations (code, artist_slug, period, customer_name, whatsapp, commission_type, brief)
      VALUES (${code}, ${slug}, ${period}, ${input.name}, ${input.whatsapp}, ${input.type}, ${input.brief})`;
    return { ok: true, code } as const;
  });
}

export async function findByCode(code: string) {
  const [row] = await db()<Reservation[]>`SELECT * FROM reservations WHERE code = ${code.trim().toUpperCase()}`;
  return row;
}

export async function listReservations() {
  return db()<Reservation[]>`SELECT * FROM reservations ORDER BY created_at DESC, id DESC LIMIT 500`;
}

export async function setStatus(id: number, status: Status) {
  await db()`UPDATE reservations SET status = ${status}, updated_at = now() WHERE id = ${id}`;
}

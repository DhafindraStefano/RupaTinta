# RupaTinta

Commission marketplace for RupaTinta's illustrators. Astro on Vercel; artist pages, the order tracker and the admin page render on demand from a Postgres (Neon) database.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (set by the Vercel Neon integration) |
| `ADMIN_PASSWORD` | Password for `/admin` |
| `SESSION_SECRET` | Signs the admin session cookie |

Pull them locally with `npx vercel env pull .env.local`.

## Database

Create the table once per database: `npm run db:setup` (uses `.env.local`). Schema: `scripts/schema.sql`.

## How booking works

- Each artist's slot total and current period live in `src/data/artists.ts` (`slots.period`, `slots.total`). Change the period to open a new round; counts are per period.
- Sending the form on `/artist/[slug]` takes a slot immediately. One active order per WhatsApp number per artist.
- Customers follow their order at `/pesanan/[code]` (or look it up at `/pesanan`).
- `/admin` lists every order with WhatsApp links. Set status to Dikerjakan / Selesai; Dibatalkan frees the slot.

## Commands

`npm run dev` · `npm run build` · `npm run db:setup`

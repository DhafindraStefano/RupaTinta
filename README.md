# RupaTinta

Commission marketplace prototype for RupaTinta's illustrators. A fully static Astro site with no server, database or
online service: accounts, slots, orders and uploaded files live in the visitor's browser (localStorage and IndexedDB, see
`src/scripts/commissions.ts`). Data does not move between browsers or devices.

## Illustrator logins

Sign in at `/masuk`. Accounts are fixed in `src/data/accounts.ts`:

| Artist | Email | Password |
|---|---|---|
| Nara Illustration | nara@rupatinta.id | nara2026 |
| Rakai Studio | rakai@rupatinta.id | rakai2026 |
| Kirana Draws | kirana@rupatinta.id | kirana2026 |
| Bima Pixel | bima@rupatinta.id | bima2026 |

They are checked in the browser and visible in the page source: fine for a prototype, never for real accounts.

## How ordering works

- Each illustrator opens slots from `/ilustrator` (period + number of slots). Slots start closed.
- Customers need no account. Sending the form on `/artist/[slug]` takes a slot and gives an order code (RT-XXXXXXXX).
  One active order per WhatsApp number per artist per period.
- Brief, price and payment are agreed on WhatsApp. The illustrator uploads the original file (JPG, PNG or SVG, no
  compression) and sets the order to Selesai; the customer then claims it at `/pesanan?kode=…`.
- Dibatalkan frees the slot. Changing the period starts a new queue.

## Commands

`npm run dev` · `npm run build`

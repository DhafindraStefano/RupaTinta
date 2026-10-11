# RupaTinta

Commission marketplace for Indonesian illustrators. A static Astro site; all data lives in Firebase project
`rupatinta-komisi` (client code: `src/scripts/commissions.ts`, config: `src/lib/firebase.ts`).

## How it works

- **Illustrators** sign up at `/daftar` (Firebase Auth, email + password), complete their profile in `/ilustrator`,
  and appear on the site once it is complete. They open slots (period + count), manage the order queue, upload
  portfolio works and finished files (JPG, PNG or SVG, stored without compression).
- **Customers** need no account. The form on `/artist?id=…` takes a slot and gives an order code (RT-XXXXXXXX).
  Brief, price and payment are agreed on WhatsApp. When the illustrator uploads the file and sets the order to
  Selesai, the customer claims it at `/pesanan?kode=…`.

## Firebase

| Piece | Where |
|---|---|
| Firestore (asia-southeast2) | `artists/{uid}` + `works`, `orders/{code}` (private, read by code), `queue/{code}` (public, masked) |
| Storage | `artists/{uid}/photo/*`, `artists/{uid}/works/*` (public), `orders/{code}/*` (readable once Selesai) |
| Rules | `firebase/firestore.rules`, `firebase/storage.rules` |

Deploy rules after editing them: `firebase deploy --only firestore:rules,storage`.

## Commands

`npm run dev` · `npm run build`

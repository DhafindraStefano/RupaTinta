// Creates the reservations table. Run once per database: npm run db:setup
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run `npx vercel env pull .env.local` first.');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
await sql.unsafe(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('reservations table ready');
await sql.end();

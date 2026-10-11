import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Fully static: there is no database, so orders, slots and accounts live in the visitor's browser (src/scripts/commissions.ts).
export default defineConfig({
  output: 'static',
  adapter: vercel(),
  build: { inlineStylesheets: 'always' }, // CSS is small: inline it, so there is no extra request
  redirects: { '/karyaku': '/pesanan', '/admin': '/masuk' }, // pages from the account-based version
});

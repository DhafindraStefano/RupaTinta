import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Pages are static by default; routes that read the reservation database opt out with `prerender = false`.
export default defineConfig({
  output: 'static',
  adapter: vercel(),
  build: { inlineStylesheets: 'always' }, // CSS is small: inline it, so there is no extra request
});

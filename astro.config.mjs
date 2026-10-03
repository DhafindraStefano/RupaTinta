import { defineConfig } from 'astro/config';
export default defineConfig({
  output: 'static',
  build: { inlineStylesheets: 'always' }, // CSS is small: inline it, so there is no extra request
});

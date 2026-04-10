// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.swiftlinkusa.com',
  trailingSlash: 'ignore',
  build: {
    // Emit pages as /ftl/index.html so they serve at both /ftl and /ftl/ on GH Pages.
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});

// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.swiftlinkusa.com',
  trailingSlash: 'ignore',
  // Astro 7's HTML compression drops the line break between text and a following link
  // ("email it to<a>"), so keep source whitespace as Astro 6 rendered it.
  compressHTML: false,
  build: {
    // Emit pages as /ftl/index.html so they serve at both /ftl and /ftl/ on GH Pages.
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});

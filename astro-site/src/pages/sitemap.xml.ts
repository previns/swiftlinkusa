import type { APIRoute } from 'astro';
import { canonicalUrl } from '../data/seo';

export const prerender = true;

// Discover static page files at build time so new pages are included automatically.
// Dynamic routes must supply their concrete URLs explicitly if introduced later.
const pages = Object.keys(import.meta.glob('./**/*.astro'));
const paths = pages
  // Private customer pages (reached only by link) stay out of the sitemap.
  .filter(page => !page.includes('[') && page !== './404.astro' && page !== './rate-confirmation.astro')
  .map(page => page.replace(/^\.\//, '/').replace(/\.astro$/, '').replace(/\/index$/, '/') );
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = ({ site }) => new Response(
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  [...new Set(paths.map(path => canonicalUrl(path, site)))].sort()
    .map(url => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n') +
  '\n</urlset>\n',
  { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
);

# SwiftLink USA — swiftlinkusa.com

Production website for **SwiftLink Logistics, LLC**, a Michigan-based 3PL freight brokerage. Built with [Astro 6](https://astro.build/) and [Tailwind CSS v4](https://tailwindcss.com/).

Live at **[www.swiftlinkusa.com](https://www.swiftlinkusa.com)**

## Repo layout

The Astro project lives in `astro-site/`. All dev and build commands run from there.

```
astro-site/
├── public/
│   ├── CNAME               # Custom domain — baked into build output
│   ├── images/             # Logos, hero backgrounds, icons
│   └── videos/             # Compressed MP4 hero videos
├── src/
│   ├── components/         # Nav, Footer, HeroCycling, ServicesGrid, etc.
│   ├── data/
│   │   └── services.ts     # Single source of truth for all service pages
│   ├── layouts/
│   │   └── BaseLayout.astro # Shared HTML shell, SEO head, fade-in observer
│   ├── pages/
│   │   ├── index.astro      # Home
│   │   ├── about.astro
│   │   ├── contact.astro
│   │   ├── careers.astro    # Careers + application modal
│   │   ├── quote.astro      # Quote request form
│   │   ├── faq.astro        # FAQ accordion
│   │   ├── terms.astro
│   │   ├── privacy.astro
│   │   └── [...slug].astro  # Dynamic service pages (FTL, LTL, Drayage, etc.)
│   └── styles/
│       └── global.css       # Tailwind import + shared component styles
└── package.json
```

## Running locally

From the repo root:

```sh
cd astro-site
npm install          # first time only
npm run dev          # dev server at http://localhost:4321
```

| Command           | Action                                      |
| :---------------- | :------------------------------------------ |
| `npm install`     | Install dependencies                        |
| `npm run dev`     | Start dev server at `localhost:4321`         |
| `npm run build`   | Build production site to `astro-site/dist/` |
| `npm run preview` | Preview the production build locally        |

## Deployment

Pushes to `main` trigger [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which builds the Astro site and deploys to GitHub Pages on the custom domain `www.swiftlinkusa.com`. The workflow can also be run manually from the Actions tab via **Run workflow**.

GitHub Pages is configured with **Source: GitHub Actions** (not branch-deploy). The `CNAME` lives at `astro-site/public/CNAME` and ships in the build output.

## Forms

All three forms submit to a [Formspree](https://formspree.io/) endpoint (`meepzjzk`):

- **Contact** — name, email, phone, message
- **Quote** — service type, origin/destination, timeline, shipment details, contact info, with client-side required-field and date-logic validation (pickup ≥ today, delivery ≥ pickup)
- **Careers** — application modal with resume upload (PDF/DOCX) and auto-fill

## Videos

Hero videos live in `astro-site/public/videos/` as compressed MP4s. Pre-compression originals are kept locally in `videos-original-backup/` (gitignored, never deployed).

To re-encode a video for the web:

```sh
ffmpeg -i original.mp4 \
  -vcodec libx264 -crf 25 -preset slow \
  -vf "scale='min(1280,iw)':-2" \
  -pix_fmt yuv420p -movflags +faststart \
  -an output.mp4
```

- **`-crf 25`** — quality/size trade-off. Try 23 for higher quality or 28 for smaller files.
- **`scale='min(1280,iw)':-2`** — caps width at 1280px, keeps aspect ratio, rounds height to even number.
- **`-movflags +faststart`** — moves the `moov` atom to the front so the browser can start playing before the file fully downloads.
- **`-an`** — strips audio. Drop this flag if a video has audio worth keeping.

Target ≤5–8 MB per hero video; `home-1.mp4` in particular was ~54 MB pre-compression.

## Future maintenance notes

### SEO maintenance

- `/sitemap.xml` is generated from static `.astro` pages at build time; `/robots.txt` advertises it. New static pages are included automatically. If dynamic routes are introduced, add their concrete URLs to the sitemap generator.
- Canonicals and sitemap entries use `https://www.swiftlinkusa.com/` with trailing slashes. Keep internal links consistent with that format.
- `src/data/seo.ts` contains shared organization facts and breadcrumb labels. Add labels there when adding pages. `StructuredData.astro` emits the organization, website, page, breadcrumbs, and service data; avoid duplicate page-specific service markup.
- Submit `https://www.swiftlinkusa.com/sitemap.xml` in Google Search Console after deployment and ownership verification. A Search Console Domain property can be verified with Google's DNS TXT record; it does not require a site code change. No Search Console account is connected by this project.
- For URL-prefix HTML-tag verification instead, set `PUBLIC_GOOGLE_SITE_VERIFICATION` to the token Google provides at build time. The tag is omitted when unset. The GitHub workflow reads the optional repository Actions variable with that name.
- Resource pages live under `src/pages/resources/`. Keep them linked from relevant services and the resource index. Do not add invented shipment stories, testimonials, addresses, ratings, or location pages.
- Decorative videos load only when visible and enabled. Small-screen, reduced-motion, and data-saving visitors start with WebP posters and can choose playback. When adding a video, also add its matching poster to `public/images/posters/`.
- Track search impressions, clicks, indexed pages, and resulting quote inquiries after launch. Sitemap submission and structured data do not guarantee rankings or rich results.

- Adding a service page: create its static `.astro` page in `astro-site/src/pages/` and append the service to [astro-site/src/data/services.ts](astro-site/src/data/services.ts). Navigation, footer, homepage service links, service structured data, and the sitemap then pick it up automatically.
- Restoring the old static HTML site: it's preserved on the `backup-old-html` branch.
- Formspree endpoint is hardcoded in the form components — rotate it in one place per form if migrating.

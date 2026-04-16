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

- Adding a service page: append to [astro-site/src/data/services.ts](astro-site/src/data/services.ts); [[...slug].astro](astro-site/src/pages/%5B...slug%5D.astro) generates the page and [Footer](astro-site/src/components/Footer.astro) picks it up automatically.
- Restoring the old static HTML site: it's preserved on the `backup-old-html` branch.
- Formspree endpoint is hardcoded in the form components — rotate it in one place per form if migrating.

# SwiftLink USA — swiftlinkusa.com

Production website for **SwiftLink Logistics, LLC**, a Michigan-based 3PL freight brokerage. Built with [Astro 6](https://astro.build/) and [Tailwind CSS v4](https://tailwindcss.com/).

Live at **[www.swiftlinkusa.com](https://www.swiftlinkusa.com)**

## Project structure

```
astro-site/
├── public/
│   ├── CNAME              # Custom domain for GitHub Pages
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
│   │   ├── about.astro      # About Us
│   │   ├── contact.astro    # Contact
│   │   ├── careers.astro    # Careers + application modal
│   │   ├── quote.astro      # Quote request form
│   │   ├── faq.astro        # FAQ accordion
│   │   ├── terms.astro      # Terms & Conditions
│   │   ├── privacy.astro    # Privacy Policy
│   │   └── [...slug].astro  # Dynamic service pages (FTL, LTL, Drayage, etc.)
│   └── styles/
│       └── global.css       # Tailwind import + shared component styles
└── package.json
```

## Commands

All commands run from the `astro-site/` directory:

| Command           | Action                                      |
| :---------------- | :------------------------------------------ |
| `npm install`     | Install dependencies                        |
| `npm run dev`     | Start dev server at `localhost:4321`         |
| `npm run build`   | Build production site to `dist/`            |
| `npm run preview` | Preview production build locally            |

## Deployment

Pushes to `main` trigger the GitHub Actions workflow at `.github/workflows/deploy.yml`, which builds the Astro site and deploys to GitHub Pages with the custom domain `www.swiftlinkusa.com`.

## Forms

All forms submit to [Formspree](https://formspree.io/) endpoint `meepzjzk`:
- **Contact** page — name, email, phone, message
- **Quote** page — service type, origin/destination, timeline, shipment details, contact info
- **Careers** page — application modal with resume upload + auto-fill from PDF/DOCX

## Videos

Hero videos are compressed MP4s served from `public/videos/`. Pre-compression originals are kept locally in `videos-original-backup/` (gitignored, never deployed).

To re-encode a video:
```sh
ffmpeg -i original.mp4 -vcodec libx264 -crf 28 -preset slow -vf "scale=1280:-2" -an output.mp4
```

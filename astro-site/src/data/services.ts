/**
 * Single source of truth for the 6 freight services.
 * Used by Nav (Solutions dropdown), Footer (Solutions list),
 * ServicesGrid (home page), and individual service pages.
 *
 * Order here defines display order everywhere.
 */
export interface Service {
  /** URL slug — page lives at /{slug} */
  slug: string;
  /** Short display name for nav/footer/cards */
  name: string;
  /** Font Awesome icon class (without `fa-solid`) */
  icon: string;
  /** One-line tagline shown under name in nav dropdown */
  tagline: string;
  /** Full marketing blurb shown on the home page service card */
  blurb: string;
}

export const services: Service[] = [
  {
    slug: "ftl",
    name: "Full Truckload (FTL)",
    icon: "fa-truck",
    tagline: "Dedicated trailers, direct delivery",
    blurb:
      "Dedicated 53' trailers exclusively for your freight. Ideal for high-volume shipments that fill an entire trailer — dry van, flatbed, or reefer. Direct point-to-point delivery with no stops, no handling, and the fastest transit times available.",
  },
  {
    slug: "ltl",
    name: "Less-Than-Truckload (LTL)",
    icon: "fa-boxes-stacked",
    tagline: "Cost-effective shared freight",
    blurb:
      "Share trailer space and only pay for what you ship. Perfect for palletized freight that doesn't require a full trailer — from 1 to 14 pallets. Consolidated with other shipments for maximum cost efficiency without sacrificing reliability.",
  },
  {
    slug: "drayage",
    name: "Drayage & Port Services",
    icon: "fa-ship",
    tagline: "Container pickup & port delivery",
    blurb:
      "Container pickup and delivery from all major U.S. ports to your warehouse or distribution center. We handle chassis management, port fees, and last-mile delivery so your imports move seamlessly from vessel to final destination.",
  },
  {
    slug: "expedited",
    name: "Expedited Freight",
    icon: "fa-bolt",
    tagline: "Time-critical, guaranteed windows",
    blurb:
      "Time-critical shipments that can't wait. Dedicated team drivers, straight trucks, or sprinter vans for guaranteed delivery windows. Hot shots, emergency restocks, and production-line-down situations handled around the clock.",
  },
  {
    slug: "heavy-haul",
    name: "Heavy Haul",
    icon: "fa-weight-hanging",
    tagline: "Oversize & overweight loads",
    blurb:
      "Oversize and overweight loads that require specialized equipment. Flatbeds, step decks, lowboys, and RGN trailers for machinery, construction equipment, and industrial cargo. We manage permits, escorts, and route planning.",
  },
  {
    slug: "hazmat",
    name: "Hazmat Shipping",
    icon: "fa-biohazard",
    tagline: "Certified hazardous materials",
    blurb:
      "Certified hazardous materials transportation across all classes. Our hazmat-endorsed carriers are fully compliant with DOT and FMCSA regulations. Proper placarding, documentation, and safety protocols handled end to end.",
  },
];

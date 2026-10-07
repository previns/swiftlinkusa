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
      "Dedicated trailer capacity for larger shipments or freight that needs its own space. We coordinate dry van, flatbed, and refrigerated options around your load.",
  },
  {
    slug: "ltl",
    name: "Less-Than-Truckload (LTL)",
    icon: "fa-boxes-stacked",
    tagline: "Cost-effective shared freight",
    blurb:
      "Shared trailer space for smaller, palletized shipments. We help you compare service options based on your freight, delivery needs, and budget.",
  },
  {
    slug: "drayage",
    name: "Drayage & Port Services",
    icon: "fa-ship",
    tagline: "Container pickup & port delivery",
    blurb:
      "Container moves between ports, rail ramps, and your warehouse. We coordinate pickup details, appointments, and container returns with carrier partners.",
  },
  {
    slug: "expedited",
    name: "Expedited Freight",
    icon: "fa-bolt",
    tagline: "Options for urgent shipments",
    blurb:
      "Shipping options for time-sensitive freight. Share your deadline so we can review available vehicles, capacity, and a realistic delivery plan.",
  },
  {
    slug: "heavy-haul",
    name: "Heavy Haul",
    icon: "fa-weight-hanging",
    tagline: "Oversize & overweight loads",
    blurb:
      "Specialized transport for oversized machinery, equipment, and industrial freight, with planning for the trailer, route, and permit requirements.",
  },
  {
    slug: "hazmat",
    name: "Hazmat Shipping",
    icon: "fa-biohazard",
    tagline: "Hazardous materials coordination",
    blurb:
      "Hazardous materials shipping coordination based on your commodity, documentation, and handling requirements. Contact us to review shipment suitability.",
  },
];

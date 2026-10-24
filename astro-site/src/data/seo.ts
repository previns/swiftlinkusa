import { services } from './services';

export const siteUrl = 'https://www.swiftlinkusa.com';
export const organizationId = `${siteUrl}/#organization`;

export function canonicalUrl(path: string, site: URL | string = siteUrl) {
  const pathname = `/${path.replace(/^\/+|\/+$/g, '')}`;
  return new URL(pathname === '/' ? '/' : `${pathname}/`, site).href;
}

export const pageNames: Record<string, string> = {
  '/about': 'About SwiftLink',
  '/contact': 'Contact SwiftLink',
  '/quote': 'Request a Freight Quote',
  '/careers': 'Careers',
  '/carriers': 'Haul for SwiftLink',
  '/customer-application': 'Customer Application',
  '/faq': 'Freight Shipping FAQ',
  '/terms': 'Terms & Conditions',
  '/privacy': 'Privacy Policy',
  '/resources': 'Shipping Resources',
  '/resources/freight-quote-checklist': 'Freight Quote Checklist',
  ...Object.fromEntries(services.map(service => [`/${service.slug}`, service.name])),
};

// Organization describes the brokerage without implying a public storefront.
export const organization = {
  '@type': 'Organization',
  '@id': organizationId,
  name: 'SwiftLink Logistics, LLC',
  alternateName: 'SwiftLink USA',
  url: `${siteUrl}/`,
  logo: `${siteUrl}/img/swiftlink-logo-email.png`,
  telephone: '+1-248-987-6776',
  email: 'info@swiftlinkusa.com',
  address: { '@type': 'PostalAddress', addressRegion: 'MI', addressCountry: 'US' },
  areaServed: { '@type': 'Place', name: 'Contiguous United States' },
  description: 'Michigan-based freight brokerage coordinating full truckload, LTL, drayage, expedited, heavy haul, and hazardous materials shipments across the contiguous United States.',
};

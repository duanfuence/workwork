/**
 * Навигационная цепочка — один источник и для видимых крошек (Breadcrumbs.astro), и для JSON-LD
 * BreadcrumbList: разметка строится из тех же элементов, поэтому разойтись с видимой цепочкой не может.
 */
import { catalogPath } from '../config/navigation';
import { canonicalUrl } from './seo';

export interface Crumb {
  label: string;
  /** Нет у текущей страницы. */
  href?: string;
}

/** Цепочка страницы каталога /kalkulyatory/: Главная → Калькуляторы. */
export function catalogCrumbs(): Crumb[] {
  return [{ label: 'Главная', href: '/' }, { label: 'Калькуляторы' }];
}

/** Цепочка страницы калькулятора: Главная → Калькуляторы (каталог) → название калькулятора. */
export function calculatorCrumbs(entry: { title: string }): Crumb[] {
  return [
    { label: 'Главная', href: '/' },
    { label: 'Калькуляторы', href: catalogPath },
    { label: entry.title },
  ];
}

interface ListItem {
  '@type': 'ListItem';
  position: number;
  name: string;
  item: string;
}

export interface BreadcrumbList {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: ListItem[];
}

/**
 * JSON-LD BreadcrumbList по видимой цепочке: адреса абсолютные, у текущей страницы (без `href`) —
 * её канонический адрес.
 */
export function breadcrumbList(
  crumbs: readonly Crumb[],
  site: string,
  pathname: string,
): BreadcrumbList {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: crumb.href ? new URL(crumb.href, `${site}/`).href : canonicalUrl(site, pathname),
    })),
  };
}

/** JSON для `<script type="application/ld+json">`: `<` экранируется, чтобы текст не закрыл тег. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

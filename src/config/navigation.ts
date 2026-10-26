export interface NavLink {
  label: string;
  href: string;
}

/** Страница каталога всех опубликованных калькуляторов. */
export const catalogPath = '/kalkulyatory/';

/** Пункты меню шапки и подвала. Ссылки ведут только на существующие страницы и разделы. */
export const navLinks: readonly NavLink[] = [
  { label: 'Калькуляторы', href: catalogPath },
  { label: 'О сервисе', href: '/#about' },
];

/**
 * Текущий ли раздел для пункта меню (`aria-current="page"`): страница пункта или любая страница внутри
 * него (у «Калькуляторов» — каталог и все калькуляторы). Ссылка на якорь и главная разделом не считаются.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  if (href.includes('#') || href === '/') return false;
  return pathname === href || pathname.startsWith(href);
}

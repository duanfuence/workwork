export interface NavLink {
  label: string;
  href: string;
}

/** Ссылки ведут только на реально существующие разделы главной страницы. */
export const navLinks: readonly NavLink[] = [
  { label: 'Калькуляторы', href: '/#catalog' },
  { label: 'Категории', href: '/#categories' },
  { label: 'О сервисе', href: '/#about' },
];

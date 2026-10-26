/** Идентификаторы разделов каталога. Меняются только вместе с документацией и URL-схемой. */
export type CategoryId = 'repair' | 'construction' | 'area-volume' | 'cost';

/**
 * Статус готовности калькулятора:
 * - `planned` — запланирован, страницы нет;
 * - `in-progress` — в разработке, страницы нет;
 * - `available` — страница опубликована, на неё можно ссылаться.
 */
export type CalculatorStatus = 'planned' | 'in-progress' | 'available';

export interface Category {
  id: CategoryId;
  title: string;
  description: string;
  /** Порядок вывода на главной странице. */
  order: number;
}

/** Поисковые метаданные страницы калькулятора (title, description, ключевые запросы). */
export interface CalculatorSeo {
  /** Содержимое <title>, до ~60 символов. */
  title: string;
  /** Содержимое meta description, до ~160 символов. */
  description: string;
  /** Целевые поисковые запросы для семантического ядра страницы. */
  keywords: readonly string[];
}

export interface CalculatorEntry {
  /** Стабильный идентификатор (латиница, kebab-case). Не меняется после публикации. */
  id: string;
  /** Часть URL на транслите. */
  slug: string;
  /** Название для карточек и заголовков. */
  title: string;
  /** Короткое название без слова «калькулятор» («Обои»): подвал и перечисления в текстах. */
  shortTitle: string;
  /**
   * Номер листа для штампа «ЛИСТ 01 · ОТДЕЛКА СТЕН» и карточки каталога. Стабильный: задаётся один раз
   * и не зависит от порядка в массиве; у каждого калькулятора свой.
   */
  sheet: number;
  /** Раздел работ в штампе листа: «Отделка стен». */
  sheetTitle: string;
  category: CategoryId;
  /** Короткое описание для карточки (одно предложение). */
  description: string;
  /** Канонический путь страницы. Ссылки на него выводятся только при статусе `available`. */
  path: `/kalkulyatory/${string}/`;
  status: CalculatorStatus;
  /** Показывать в разделе популярных инструментов на главной. */
  popular: boolean;
  /** Дополнительные слова для поиска по каталогу (синонимы, материалы, разговорные формы). */
  searchTerms: readonly string[];
  seo: CalculatorSeo;
}

/**
 * Ориентиры расхода для калькуляторов краски, штукатурки и шпаклёвки — единственный источник для выбора
 * «Тип материала» у поля расхода и для таблиц ориентиров на страницах.
 *
 * Значения — по техническим описаниям производителей: docs/research/MATERIAL_PRESETS.md (дата, ссылки, разброс).
 * Ориентир — на стороне большего расхода: для кг/м² — верхняя граница разброса, для укрывистости (м²/л) — нижняя.
 * Формулы калькуляторов не меняются: ориентир только подставляет число в поле, поле остаётся главным.
 */

export type PresetCalculator = 'paint' | 'plaster' | 'putty';

/** Когда проверены значения по источникам (docs/research/MATERIAL_PRESETS.md). */
export const presetsCheckedAt = '2026-10-26';

export interface MaterialPreset {
  /** Стабильный идентификатор (значение в выборе). */
  id: string;
  calculator: PresetCalculator;
  /** Название в выборе и таблице: «Гипсовая». */
  label: string;
  /** Для строки в результате: «Расход: ориентир для <forNote> — сверьте с упаковкой». */
  forNote: string;
  /** Значение в единицах поля: м²/л (краска), кг/(м²·мм) (штукатурка), кг/м² на слой (шпаклёвка). */
  value: number;
  /** Разброс у проверенных производителей в тех же единицах. */
  range: { min: number; max: number };
  /** При какой толщине слоя указан расход шпаклёвки, мм. */
  layerMm?: number;
  /** Короткое пояснение к ориентиру. */
  note: string;
  /** Продукты, по которым собран разброс (для таблицы на странице). */
  sources: readonly string[];
  /** Заголовок раздела в docs/research/MATERIAL_PRESETS.md с источниками и датой проверки. */
  research: string;
}

export const materialPresets: readonly MaterialPreset[] = [
  {
    id: 'paint-interior',
    calculator: 'paint',
    label: 'Водно-дисперсионная',
    forNote: 'водно-дисперсионной интерьерной краски',
    value: 7,
    range: { min: 7, max: 14 },
    note: 'Неровная впитывающая поверхность (свежая шпаклёвка, штукатурка); по ровной загрунтованной расход меньше.',
    sources: [
      'Tikkurila Prof Euro 7',
      'düfa Mattlatex RD100',
      'PARADE Professional Q10',
      'PARADE Classic W3',
    ],
    research: 'Краска: водно-дисперсионная интерьерная для стен и потолков (м²/л на один слой)',
  },
  {
    id: 'plaster-gypsum',
    calculator: 'plaster',
    label: 'Гипсовая',
    forNote: 'гипсовой штукатурки',
    value: 1.3,
    range: { min: 0.8, max: 1.3 },
    note: 'Лёгкие смеси расходуются меньше (около 0,85 кг на 1 мм).',
    sources: ['КНАУФ-Ротбанд', 'КНАУФ-ХП Старт', 'ВОЛМА-Слой', 'Bergauf BAU PUTZ GIPS'],
    research: 'Штукатурка гипсовая (кг/м² на 1 мм)',
  },
  {
    id: 'plaster-cement',
    calculator: 'plaster',
    label: 'Цементная',
    forNote: 'цементной штукатурки',
    value: 1.8,
    range: { min: 1.4, max: 1.8 },
    note: 'Цементно-песчаные смеси тяжелее гипсовых.',
    sources: [
      'ВОЛМА-Аквастарт',
      'Bergauf BAU PUTZ ZEMENT',
      'Основит Техно РС21/2 MF',
      'Старатели, цементная',
    ],
    research: 'Штукатурка цементная (кг/м² на 1 мм)',
  },
  {
    id: 'putty-gypsum-start',
    calculator: 'putty',
    label: 'Гипсовая стартовая',
    forNote: 'гипсовой стартовой шпаклёвки',
    value: 1,
    range: { min: 0.8, max: 1 },
    layerMm: 1,
    note: 'При слое 1 мм; стартовый слой часто толще — при 2 мм расход вдвое больше.',
    sources: ['ВОЛМА-Стандарт', 'Старатели «Базовая»', 'Основит Версилк PG34 W'],
    research: 'Шпаклёвка гипсовая стартовая (базовая, выравнивающая), кг/м² на слой 1 мм',
  },
  {
    id: 'putty-gypsum-finish',
    calculator: 'putty',
    label: 'Гипсовая финишная',
    forNote: 'гипсовой финишной шпаклёвки',
    value: 1,
    range: { min: 0.9, max: 1 },
    layerMm: 1,
    note: 'При слое 1 мм; финишный слой обычно тоньше.',
    sources: ['КНАУФ-ХП Финиш', 'ВОЛМА-Финиш', 'Старатели «Финишная»'],
    research: 'Шпаклёвка гипсовая финишная, кг/м² на слой 1 мм',
  },
  {
    id: 'putty-polymer-paste',
    calculator: 'putty',
    label: 'Полимерная паста',
    forNote: 'готовой полимерной шпаклёвки',
    value: 1.7,
    range: { min: 1.6, max: 1.7 },
    layerMm: 1,
    note: 'При слое 1 мм; паста тяжелее сухих смесей — в ведре уже есть вода.',
    sources: ['Ceresit IN 95 PREMIUM', 'Основит Эконсилк PA391 MW', 'Старатели «Суперфинишная»'],
    research: 'Шпаклёвка полимерная готовая (паста в ведре), кг/м² на слой 1 мм',
  },
];

/** Ориентиры одного калькулятора в порядке списка. */
export function presetsFor(calculator: PresetCalculator): MaterialPreset[] {
  return materialPresets.filter((preset) => preset.calculator === calculator);
}

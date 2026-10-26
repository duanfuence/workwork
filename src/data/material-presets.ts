/**
 * Ориентиры расхода для калькуляторов краски, штукатурки и шпаклёвки — единственный источник для выбора
 * «Тип материала» у поля расхода, пометки в результате и таблиц ориентиров на страницах.
 *
 * Значения — по техническим описаниям производителей: docs/research/MATERIAL_PRESETS.md (дата, ссылки).
 * Правило (D-023): ориентир расхода — медиана верхних границ продуктов, вверх до 0,1; ориентир укрывистости —
 * медиана нижних границ, вниз до целого (`presetValueByRule`, тест сверяет с ним каждое значение). Разброс между
 * марками покрывает поле «Запас», а не сам ориентир.
 * Формулы калькуляторов не меняются: ориентир только подставляет число в поле, поле остаётся главным.
 */

export type PresetCalculator = 'paint' | 'plaster' | 'putty';

/** Когда проверены значения по источникам (docs/research/MATERIAL_PRESETS.md). */
export const presetsCheckedAt = '2026-10-26';

/** Единица ориентира в пометке результата и подписи таблицы. */
export const presetUnits: Record<PresetCalculator, string> = {
  paint: 'м²/л',
  plaster: 'кг/м² на 1 мм',
  putty: 'кг/м² при слое 1 мм',
};

/** Продукт-источник: значение производителя в единицах поля; одно число — `min` и `max` равны. */
export interface PresetSource {
  name: string;
  min: number;
  max: number;
}

export interface MaterialPreset {
  /** Стабильный идентификатор (значение в выборе). */
  id: string;
  calculator: PresetCalculator;
  /** Название в выборе и таблице: «Гипсовая». */
  label: string;
  /** Для пометки в результате: «Ориентир для <forNote>; у разных марок от X до Y — сверьте с упаковкой». */
  forNote: string;
  /** Ориентир в единицах поля: м²/л (краска), кг/(м²·мм) (штукатурка), кг/м² на слой (шпаклёвка). */
  value: number;
  /** При какой толщине слоя указан расход шпаклёвки, мм. */
  layerMm?: number;
  /** Короткое пояснение к ориентиру. */
  note: string;
  /** Продукты, по которым посчитан ориентир и разброс. */
  sources: readonly PresetSource[];
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
    note: 'Первый слой по впитывающей поверхности (свежая шпаклёвка, штукатурка); по ровной загрунтованной укрывистость выше.',
    sources: [
      { name: 'Tikkurila Prof Euro 7', min: 7, max: 14 },
      { name: 'düfa Mattlatex RD100', min: 7, max: 12 },
      { name: 'PARADE Professional Q10', min: 8.5, max: 9 },
      { name: 'PARADE Classic W3', min: 12, max: 12 },
    ],
    research: 'Краска: водно-дисперсионная интерьерная для стен и потолков (м²/л на один слой)',
  },
  {
    id: 'plaster-gypsum',
    calculator: 'plaster',
    label: 'Гипсовая',
    forNote: 'гипсовой штукатурки',
    value: 1,
    note: 'Тяжёлые смеси расходуются больше (до 1,3 кг на 1 мм) — разброс покрывает запас.',
    sources: [
      { name: 'КНАУФ-Ротбанд', min: 0.85, max: 0.85 },
      { name: 'КНАУФ-ХП Старт', min: 1, max: 1 },
      { name: 'ВОЛМА-Слой', min: 0.8, max: 0.9 },
      { name: 'Bergauf BAU PUTZ GIPS', min: 1.1, max: 1.3 },
    ],
    research: 'Штукатурка гипсовая (кг/м² на 1 мм)',
  },
  {
    id: 'plaster-cement',
    calculator: 'plaster',
    label: 'Цементная',
    forNote: 'цементной штукатурки',
    value: 1.6,
    note: 'Цементно-песчаные смеси тяжелее гипсовых.',
    sources: [
      { name: 'ВОЛМА-Аквастарт', min: 1.4, max: 1.6 },
      { name: 'Bergauf BAU PUTZ ZEMENT', min: 1.6, max: 1.8 },
      { name: 'Основит Техно РС21/2 MF', min: 1.6, max: 1.6 },
      { name: 'Старатели, цементная', min: 1.4, max: 1.5 },
    ],
    research: 'Штукатурка цементная (кг/м² на 1 мм)',
  },
  {
    id: 'putty-gypsum-start',
    calculator: 'putty',
    label: 'Гипсовая стартовая',
    forNote: 'гипсовой стартовой шпаклёвки',
    value: 1,
    layerMm: 1,
    note: 'При слое 1 мм; стартовый слой часто толще — при 2 мм расход вдвое больше.',
    sources: [
      { name: 'ВОЛМА-Стандарт', min: 0.8, max: 1 },
      { name: 'Старатели «Базовая»', min: 1, max: 1 },
      { name: 'Основит Версилк PG34 W', min: 0.8, max: 0.9 },
    ],
    research: 'Шпаклёвка гипсовая стартовая (базовая, выравнивающая), кг/м² на слой 1 мм',
  },
  {
    id: 'putty-gypsum-finish',
    calculator: 'putty',
    label: 'Гипсовая финишная',
    forNote: 'гипсовой финишной шпаклёвки',
    value: 0.9,
    layerMm: 1,
    note: 'При слое 1 мм; финишный слой обычно тоньше.',
    sources: [
      { name: 'КНАУФ-ХП Финиш', min: 0.9, max: 0.9 },
      { name: 'ВОЛМА-Финиш', min: 0.9, max: 1 },
      { name: 'Старатели «Финишная»', min: 0.9, max: 0.9 },
    ],
    research: 'Шпаклёвка гипсовая финишная, кг/м² на слой 1 мм',
  },
  {
    id: 'putty-polymer-paste',
    calculator: 'putty',
    label: 'Полимерная паста',
    forNote: 'готовой полимерной шпаклёвки',
    value: 1.7,
    layerMm: 1,
    note: 'При слое 1 мм; паста тяжелее сухих смесей — в ведре уже есть вода.',
    sources: [
      { name: 'Ceresit IN 95 PREMIUM', min: 1.7, max: 1.7 },
      { name: 'Основит Эконсилк PA391 MW', min: 1.6, max: 1.6 },
      { name: 'Старатели «Суперфинишная»', min: 1.7, max: 1.7 },
    ],
    research: 'Шпаклёвка полимерная готовая (паста в ведре), кг/м² на слой 1 мм',
  },
];

/** Ориентиры одного калькулятора в порядке списка. */
export function presetsFor(calculator: PresetCalculator): MaterialPreset[] {
  return materialPresets.filter((preset) => preset.calculator === calculator);
}

/** Разброс у проверенных марок: от наименьшей нижней границы до наибольшей верхней. */
export function presetRange(preset: MaterialPreset): { min: number; max: number } {
  return {
    min: Math.min(...preset.sources.map((source) => source.min)),
    max: Math.max(...preset.sources.map((source) => source.max)),
  };
}

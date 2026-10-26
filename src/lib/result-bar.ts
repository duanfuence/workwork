/**
 * Панель итога внизу экрана на телефоне и объявление результата для экранного диктора (UX-1, D-024).
 * Чистые функции без DOM: их использует общий механизм форм (src/client/calculator-form.ts).
 */

export type ResultState = 'empty' | 'invalid' | 'ready';

/** Текст панели, пока в полях ошибки. */
export const resultBarInvalidText = 'Исправьте значения в полях';

/** Пауза ввода, после которой диктор объявляет новый итог, мс. */
export const announceDelayMs = 1000;

/** Доля высоты окна, меньше которой видимая область означает открытую экранную клавиатуру. */
const keyboardHeightRatio = 0.75;

export interface ResultBarInput {
  /** Был успешный расчёт после последнего «Сбросить» (до него панели нет). */
  calculated: boolean;
  state: ResultState;
  /** Экран уже 960 px: на широком результат и так виден рядом с формой. */
  narrow: boolean;
  /** Главный результат (или сообщение об ошибках) виден на экране. */
  resultInView: boolean;
  keyboardOpen: boolean;
  /** Короткий итог из `render` калькулятора: «11,9 л краски · 3 банки». */
  summary: string;
}

export type ResultBarView =
  { visible: false } | { visible: true; tone: 'ready' | 'invalid'; text: string };

/** Показывать ли панель итога и что в ней написать. */
export function resultBarView(input: ResultBarInput): ResultBarView {
  const hidden =
    !input.calculated ||
    !input.narrow ||
    input.resultInView ||
    input.keyboardOpen ||
    input.state === 'empty';
  if (hidden) return { visible: false };
  if (input.state === 'invalid')
    return { visible: true, tone: 'invalid', text: resultBarInvalidText };
  return input.summary === ''
    ? { visible: false }
    : { visible: true, tone: 'ready', text: input.summary };
}

/**
 * Открыта ли экранная клавиатура: фокус в текстовом поле, а видимая область заметно ниже полной высоты окна.
 * `visibleHeight` — высота visualViewport с учётом масштаба (без него — высота окна): при масштабировании
 * пальцами она не меняется, при клавиатуре — уменьшается. `fullHeight` — наибольшая высота окна при той же ширине:
 * старые Android уменьшают само окно, а не только видимую область.
 */
export function keyboardLikelyOpen(
  textFieldFocused: boolean,
  visibleHeight: number,
  fullHeight: number,
): boolean {
  return textFieldFocused && fullHeight > 0 && visibleHeight < fullHeight * keyboardHeightRatio;
}

/** Что объявить диктору: итог, сообщение об ошибках или ничего до расчёта. */
export function resultAnnouncement(state: ResultState, summary: string): string {
  if (state === 'ready') return summary === '' ? '' : `Результат: ${summary}`;
  if (state === 'invalid') return 'Расчёт не выполнен: исправьте значения в полях.';
  return '';
}

/**
 * Поля области, где результат считается видимым: сверху — липкая шапка, снизу — сама панель итога, px.
 * Те же числа — `rootMargin` у IntersectionObserver.
 */
export const resultViewInset = { top: 64, bottom: 80 } as const;

/** Виден ли результат: не меньше половины его высоты — между шапкой и панелью итога. */
export function resultInView(top: number, bottom: number, viewportHeight: number): boolean {
  const height = bottom - top;
  if (height <= 0) return false;
  const visible =
    Math.min(bottom, viewportHeight - resultViewInset.bottom) - Math.max(top, resultViewInset.top);
  return visible >= height / 2;
}

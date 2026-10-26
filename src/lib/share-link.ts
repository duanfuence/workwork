/**
 * Ссылка на расчёт и текст итога для «Скопировать итог» (D-027). Чистые функции без DOM: их использует общий
 * механизм форм (src/client/calculator-form.ts).
 *
 * Формат ссылки: `?v=1&<имя поля>=<значение>&…` — имена полей формы, числа с точкой (`wallHeight=2.7`),
 * выборы — значением варианта (`mode=room`), пустое поле — пустым значением (`reserve=`): иначе при открытии в нём
 * оказалось бы значение по умолчанию, и ссылка зависела бы от его будущих изменений. Скрытые поля не передаются.
 */
import { parseDecimal } from './number';
import { fmt } from './validation';

/** Версия формата ссылки. */
export const shareVersion = '1';

/** Поле формы, которое может прийти из ссылки: число или выбор из вариантов. */
export type ShareControl =
  { name: string; kind: 'number' } | { name: string; kind: 'choice'; options: readonly string[] };

export interface ShareValue {
  name: string;
  kind: 'number' | 'choice';
  value: string;
}

/** Длиннее — заведомо не значение поля: такой параметр не читается. */
const maxValueLength = 32;

/** Значения видимых полей формы → строка запроса без `?`. Нечисловой текст в числовом поле не передаётся. */
export function buildShareQuery(values: readonly ShareValue[]): string {
  const params = new URLSearchParams({ v: shareVersion });
  for (const { name, kind, value } of values) {
    if (kind === 'choice') {
      if (value !== '') params.set(name, value);
      continue;
    }
    const parsed = parseDecimal(value);
    if (parsed.kind === 'number') params.set(name, String(parsed.value));
    else if (parsed.kind === 'empty') params.set(name, '');
  }
  return params.toString();
}

/**
 * Строка запроса → текст полей формы (десятичная запятая). `null` — не ссылка на расчёт (нет `v=1`). Неизвестные
 * параметры, текст вместо числа и несуществующий вариант выбора молча пропускаются; итог проверяет сам калькулятор.
 */
export function parseShareQuery(
  search: string,
  controls: readonly ShareControl[],
): Record<string, string> | null {
  const params = new URLSearchParams(search);
  if (params.get('v') !== shareVersion) return null;
  const values: Record<string, string> = {};
  for (const control of controls) {
    const raw = params.get(control.name)?.trim();
    if (raw === undefined || raw.length > maxValueLength) continue;
    if (control.kind === 'choice') {
      if (control.options.includes(raw)) values[control.name] = raw;
      continue;
    }
    const parsed = parseDecimal(raw);
    if (parsed.kind === 'number') values[control.name] = fmt(parsed.value);
    else if (parsed.kind === 'empty') values[control.name] = '';
  }
  return values;
}

/**
 * Что подставить при открытии: значения из ссылки важнее сохранённых размеров комнаты — если в ссылке есть хоть одно
 * значение, сохранённые размеры не подставляются вовсе.
 */
export function startValues(
  link: Record<string, string> | null,
  remembered: Record<string, string>,
): { source: 'link' | 'memory' | 'none'; values: Record<string, string> } {
  if (link !== null && Object.keys(link).length > 0) return { source: 'link', values: link };
  if (Object.keys(remembered).length > 0) return { source: 'memory', values: remembered };
  return { source: 'none', values: {} };
}

export interface ShareReport {
  /** Название калькулятора: «Калькулятор краски». */
  title: string;
  /** Ключевые параметры — строками, как на экране. */
  params: readonly string[];
  /** Что купить: «5 банок по 2,7 л (13,5 л)». */
  purchase: string;
  url: string;
}

/** Текст для «Скопировать итог»: название, параметры, к покупке, ссылка. */
export function shareText({ title, params, purchase, url }: ShareReport): string {
  return [`${title} — ДомРасчёт`, ...params, `К покупке: ${purchase}`, url].join('\n');
}

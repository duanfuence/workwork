import { parseNumberFields, withParseErrors } from '../form';
import { calculatePaint, type PaintCalculation, type PaintField } from './paint';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const paintFields = [
  'roomLength',
  'roomWidth',
  'wallHeight',
  'openingsArea',
  'ceiling',
  'coats',
  'coverage',
  'reserve',
  'canVolume',
] as const satisfies readonly PaintField[];

const numberFields = [
  'roomLength',
  'roomWidth',
  'wallHeight',
  'openingsArea',
  'coats',
  'coverage',
  'reserve',
  'canVolume',
] as const satisfies readonly PaintField[];

export type PaintFormValues = Record<PaintField, string>;

/** Разбирает текст полей формы и выполняет расчёт. Выбор «потолок» передаётся как есть. */
export function evaluatePaintForm(values: PaintFormValues): PaintCalculation {
  const parsed = parseNumberFields(numberFields, values);
  const calculation = calculatePaint({ ...parsed.values, ceiling: values.ceiling || null });
  return withParseErrors(calculation, parsed.errors);
}

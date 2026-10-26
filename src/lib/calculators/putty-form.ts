import { parseNumberFields, withParseErrors } from '../form';
import { calculatePutty, type PuttyCalculation, type PuttyField } from './putty';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const puttyFields = [
  'wallLength',
  'wallHeight',
  'wallCount',
  'openingsArea',
  'layers',
  'consumption',
  'packMass',
  'reserve',
] as const satisfies readonly PuttyField[];

export type PuttyFormValues = Record<PuttyField, string>;

/** Разбирает текст полей формы и выполняет расчёт. */
export function evaluatePuttyForm(values: PuttyFormValues): PuttyCalculation {
  const parsed = parseNumberFields(puttyFields, values);
  return withParseErrors(calculatePutty(parsed.values), parsed.errors);
}

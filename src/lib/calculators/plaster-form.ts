import { parseNumberFields, withParseErrors } from '../form';
import { calculatePlaster, type PlasterCalculation, type PlasterField } from './plaster';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const plasterFields = [
  'wallLength',
  'wallHeight',
  'wallCount',
  'openingsArea',
  'thickness',
  'consumption',
  'bagMass',
  'reserve',
] as const satisfies readonly PlasterField[];

export type PlasterFormValues = Record<PlasterField, string>;

/** Разбирает текст полей формы и выполняет расчёт. */
export function evaluatePlasterForm(values: PlasterFormValues): PlasterCalculation {
  const parsed = parseNumberFields(plasterFields, values);
  return withParseErrors(calculatePlaster(parsed.values), parsed.errors);
}

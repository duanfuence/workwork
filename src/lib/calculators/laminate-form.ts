import { parseNumberFields, withParseErrors } from '../form';
import { calculateLaminate, type LaminateCalculation, type LaminateField } from './laminate';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const laminateFields = [
  'roomLength',
  'roomWidth',
  'boardLength',
  'boardWidth',
  'boardsPerPack',
  'direction',
  'scheme',
  'minPiece',
  'minOffset',
  'reserve',
  'packPrice',
] as const satisfies readonly LaminateField[];

const numberFields = [
  'roomLength',
  'roomWidth',
  'boardLength',
  'boardWidth',
  'boardsPerPack',
  'minPiece',
  'minOffset',
  'reserve',
  'packPrice',
] as const satisfies readonly LaminateField[];

export type LaminateFormValues = Record<(typeof laminateFields)[number], string>;

/** Разбирает текст полей формы и выполняет расчёт. Направление и схема передаются как есть. */
export function evaluateLaminateForm(values: LaminateFormValues): LaminateCalculation {
  const parsed = parseNumberFields(numberFields, values);
  const calculation = calculateLaminate({
    ...parsed.values,
    direction: values.direction || null,
    scheme: values.scheme || null,
    // Полей зазора и пропила на странице пока нет (подэтап интерфейса): страница считает без них,
    // как модель 1.2, и её пояснения остаются верными.
    gap: 0,
    kerf: 0,
  });
  return withParseErrors(calculation, parsed.errors);
}

import { parseNumberFields, withParseErrors } from '../form';
import { calculateTile, type TileCalculation, type TileField } from './tile';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const tileFields = [
  'surface',
  'surfaceLength',
  'surfaceWidth',
  'surfaceCount',
  'tileLength',
  'tileWidth',
  'joint',
  'reserve',
  'tilesPerPack',
  'tilePrice',
  'tilePriceUnit',
] as const satisfies readonly TileField[];

const numberFields = [
  'surfaceLength',
  'surfaceWidth',
  'surfaceCount',
  'tileLength',
  'tileWidth',
  'joint',
  'reserve',
  'tilesPerPack',
  'tilePrice',
] as const satisfies readonly TileField[];

export type TileFormValues = Record<TileField, string>;

/** Разбирает текст полей формы и выполняет расчёт. Тип поверхности и единица цены передаются как есть. */
export function evaluateTileForm(values: TileFormValues): TileCalculation {
  const parsed = parseNumberFields(numberFields, values);
  const calculation = calculateTile({
    ...parsed.values,
    surface: values.surface || null,
    tilePriceUnit: values.tilePriceUnit || null,
  });
  return withParseErrors(calculation, parsed.errors);
}

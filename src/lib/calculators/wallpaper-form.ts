import { parseDecimal } from '../number';
import {
  calculateWallpaper,
  type WallpaperCalculation,
  type WallpaperErrors,
  type WallpaperField,
  type WallpaperInput,
} from './wallpaper';

export const wallpaperFields = [
  'roomLength',
  'roomWidth',
  'wallHeight',
  'windowCount',
  'windowWidth',
  'windowHeight',
  'doorCount',
  'doorWidth',
  'doorHeight',
  'rollWidth',
  'rollLength',
  'patternRepeat',
  'trimAllowance',
  'rollPrice',
] as const satisfies readonly WallpaperField[];

export type WallpaperFormValues = Record<WallpaperField, string>;

/** Поля, которые не участвуют в расчёте, если соответствующих проёмов нет. */
const dependsOnCount: Partial<Record<WallpaperField, WallpaperField>> = {
  windowWidth: 'windowCount',
  windowHeight: 'windowCount',
  doorWidth: 'doorCount',
  doorHeight: 'doorCount',
};

/**
 * Разбирает текст полей формы и выполняет расчёт.
 * Ошибка разбора («Введите число») важнее ошибки расчёта для того же поля.
 */
export function evaluateWallpaperForm(values: WallpaperFormValues): WallpaperCalculation {
  const parseErrors: WallpaperErrors = {};
  const input = {} as WallpaperInput;

  for (const field of wallpaperFields) {
    const parsed = parseDecimal(values[field]);
    if (parsed.kind === 'number') {
      input[field] = parsed.value;
    } else {
      input[field] = null;
      if (parsed.kind === 'invalid') parseErrors[field] = 'Введите число.';
    }
  }

  // Размеры проёмов игнорируются, если количество не указано или равно нулю.
  for (const [field, countField] of Object.entries(dependsOnCount) as [
    WallpaperField,
    WallpaperField,
  ][]) {
    if (!input[countField]) delete parseErrors[field];
  }

  const calculation = calculateWallpaper(input);
  if (Object.keys(parseErrors).length === 0) return calculation;
  const errors = calculation.ok ? parseErrors : { ...calculation.errors, ...parseErrors };
  return { ok: false, errors };
}

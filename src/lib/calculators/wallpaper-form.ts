import { parseNumberFields, withParseErrors } from '../form';
import { calculateWallpaper, type WallpaperCalculation, type WallpaperField } from './wallpaper';

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

/** Размеры проёмов не участвуют в расчёте, если проёмов нет, — их ошибки ввода не показываются. */
const dependsOnCount = {
  windowWidth: 'windowCount',
  windowHeight: 'windowCount',
  doorWidth: 'doorCount',
  doorHeight: 'doorCount',
} as const satisfies Partial<Record<WallpaperField, WallpaperField>>;

/** Разбирает текст полей формы и выполняет расчёт. */
export function evaluateWallpaperForm(values: WallpaperFormValues): WallpaperCalculation {
  const parsed = parseNumberFields(wallpaperFields, values);
  for (const [field, countField] of Object.entries(dependsOnCount) as [
    WallpaperField,
    WallpaperField,
  ][]) {
    if (!parsed.values[countField]) delete parsed.errors[field];
  }
  return withParseErrors(calculateWallpaper(parsed.values), parsed.errors);
}

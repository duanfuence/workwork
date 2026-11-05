/**
 * Размеры комнаты между калькуляторами (D-026): длина, ширина и высота стен сохраняются в браузере после
 * успешного расчёта «по помещению» и подставляются в пустые поля другого калькулятора. Чистые функции без DOM
 * и без хранилища: чтение и запись — в src/client/calculator-form.ts.
 *
 * Сохраняются только эти три числа; формат — JSON с версией: `{"v":1,"roomLength":4,"roomWidth":3,"wallHeight":2.7}`.
 */
import { parseDecimal } from './number';
import { fmt } from './validation';

export const roomFields = ['roomLength', 'roomWidth', 'wallHeight'] as const;
export type RoomField = (typeof roomFields)[number];
export type RoomSizes = Partial<Record<RoomField, number>>;

/** Ключ в localStorage. */
export const roomStorageKey = 'domraschet:room';
/** Версия формата; запись другой версии не читается. */
export const roomStorageVersion = 1;

/** Поле помещения на странице: текст и видно ли оно (поле другого режима — нет). */
export interface RoomControl {
  value: string;
  active: boolean;
}
export type RoomControls = Partial<Record<RoomField, RoomControl>>;

/** Заведомо неправдоподобные размеры не читаются: проверку пределов делает калькулятор. */
const plausible = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000;

/**
 * Что сохранить после успешного расчёта: числа из видимых полей помещения. Только если видны длина и ширина
 * помещения — расчёт отдельной стены (шпаклёвка, штукатурка) размеров комнаты не меняет.
 */
export function roomToSave(controls: RoomControls): RoomSizes | null {
  if (!controls.roomLength?.active || !controls.roomWidth?.active) return null;
  const sizes: RoomSizes = {};
  for (const field of roomFields) {
    const control = controls[field];
    if (!control?.active) continue;
    const parsed = parseDecimal(control.value);
    if (parsed.kind === 'number' && plausible(parsed.value)) sizes[field] = parsed.value;
  }
  return sizes.roomLength !== undefined && sizes.roomWidth !== undefined ? sizes : null;
}

/** Новая запись поверх прошлой: высота остаётся, если в этом калькуляторе её нет (ламинат). */
export function mergeRoom(previous: RoomSizes | null, next: RoomSizes): RoomSizes {
  return { ...previous, ...next };
}

export function serializeRoom(sizes: RoomSizes): string {
  return JSON.stringify({ v: roomStorageVersion, ...sizes });
}

/** Разбор записи из хранилища; повреждённая запись или другая версия — `null`. */
export function parseStoredRoom(raw: string | null): RoomSizes | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record['v'] !== roomStorageVersion) return null;
  const sizes: RoomSizes = {};
  for (const field of roomFields) {
    const value = record[field];
    if (plausible(value)) sizes[field] = value;
  }
  return Object.keys(sizes).length > 0 ? sizes : null;
}

/**
 * Что подставить при открытии калькулятора: сохранённые размеры — только в видимые пустые поля и только если
 * на странице видно поле длины помещения. Заполненные поля не трогаются.
 */
export function roomFill(
  stored: RoomSizes | null,
  controls: RoomControls,
): Partial<Record<RoomField, string>> {
  const fill: Partial<Record<RoomField, string>> = {};
  if (stored === null || !controls.roomLength?.active) return fill;
  for (const field of roomFields) {
    const control = controls[field];
    const value = stored[field];
    if (control?.active && control.value.trim() === '' && value !== undefined)
      fill[field] = fmt(value);
  }
  return fill;
}

/** Размеры для строки над формой: «4 × 3 × 2,7 м». */
export function roomNoticeSizes(fill: Partial<Record<RoomField, string>>): string {
  const parts = roomFields.flatMap((field) => {
    const value = fill[field];
    return value === undefined ? [] : [value];
  });
  return parts.length === 0 ? '' : `${parts.join(' × ')} м`;
}

/**
 * Мягкое предупреждение о нетипичном значении поля с ориентирами (укрывистость краски, расход штукатурки и шпаклёвки):
 * «Обычно 7–14 м²/л — проверьте этикетку.» Это не ошибка — расчёт выполняется. Чистая функция без DOM; разброс —
 * `presetTypicalRange` из src/data/material-presets.ts.
 */
import { parseDecimal } from './number';
import { fmt } from './validation';

export interface TypicalRange {
  /** Наименьшее и наибольшее значение у проверенных марок. */
  min: number;
  max: number;
  unit: string;
  /** Предупреждать, если значение меньше `min / lowFactor`. */
  lowFactor: number;
  /** Предупреждать, если значение больше `max · highFactor`; `null` — сверху не предупреждать. */
  highFactor: number | null;
  /** Где проверить значение: «этикетку», «упаковку». */
  where: string;
}

/** Текст предупреждения или `null`: значение в обычных пределах, поле пустое или не число. */
export function typicalWarning(range: TypicalRange, text: string): string | null {
  const parsed = parseDecimal(text);
  if (parsed.kind !== 'number' || parsed.value <= 0) return null;
  const tooLow = parsed.value < range.min / range.lowFactor;
  const tooHigh = range.highFactor !== null && parsed.value > range.max * range.highFactor;
  if (!tooLow && !tooHigh) return null;
  return `Обычно ${fmt(range.min)}–${fmt(range.max)} ${range.unit} — проверьте ${range.where}.`;
}

/** Разбор `data-typical` из разметки (JSON `TypicalRange`); повреждённое значение — `null`, без предупреждений. */
export function parseTypicalRange(json: string | undefined): TypicalRange | null {
  if (json === undefined) return null;
  try {
    const data: unknown = JSON.parse(json);
    if (typeof data !== 'object' || data === null) return null;
    const { min, max, unit, lowFactor, highFactor, where } = data as Record<string, unknown>;
    const finite = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value);
    if (
      !finite(min) ||
      !finite(max) ||
      !finite(lowFactor) ||
      min <= 0 ||
      max < min ||
      lowFactor < 1
    )
      return null;
    if (highFactor !== null && (!finite(highFactor) || highFactor < 1)) return null;
    if (typeof unit !== 'string' || typeof where !== 'string') return null;
    return { min, max, unit, lowFactor, highFactor, where };
  } catch {
    return null;
  }
}

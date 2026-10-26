import { describe, expect, it } from 'vitest';
import { spokenUnit } from './units';

/** Исходники страниц калькуляторов как текст (Vite `?raw`): все `unit="…"` из NumberField. */
const pageSources = import.meta.glob<string>('../pages/kalkulyatory/**/*.astro', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const usedUnits = new Set(
  Object.values(pageSources).flatMap((source) =>
    [...source.matchAll(/\bunit="([^"]+)"/g)].map((match) => match[1] ?? ''),
  ),
);

describe('spokenUnit', () => {
  it('переводит сокращения в слова для скринридера', () => {
    expect(spokenUnit('мм')).toBe('в миллиметрах');
    expect(spokenUnit('м²')).toBe('в квадратных метрах');
    expect(spokenUnit('шт.')).toBe('в штуках');
    expect(spokenUnit('кг/м²')).toBe('в килограммах на квадратный метр');
  });

  it('у каждой единицы на страницах калькуляторов есть словесная форма', () => {
    expect(usedUnits.size).toBeGreaterThan(5);
    for (const unit of usedUnits) expect(() => spokenUnit(unit), unit).not.toThrow();
  });

  it('неизвестная единица — ошибка, а не пустая строка', () => {
    expect(() => spokenUnit('фут')).toThrow('Нет словесной формы для единицы «фут»');
  });
});

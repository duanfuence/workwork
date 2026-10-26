import { describe, expect, it } from 'vitest';
import { checkOptional, checkRequired, fmt, hasPrecision } from './validation';

const range = { min: 0.1, max: 100 };

describe('checkRequired', () => {
  it.each([
    [null, 'Заполните поле.'],
    [Number.NaN, 'Введите число.'],
    [Infinity, 'Введите число.'],
    [0, 'Значение должно быть больше нуля.'],
    [-1, 'Значение должно быть больше нуля.'],
    [0.05, 'Не меньше 0,1 м.'],
    [100.1, 'Не больше 100 м.'],
  ])('%s → %s', (value, message) => {
    expect(checkRequired(value, range, 'м')).toBe(message);
  });

  it('границы диапазона допустимы', () => {
    expect(checkRequired(0.1, range, 'м')).toBeNull();
    expect(checkRequired(100, range, 'м')).toBeNull();
  });

  it('единица без точки — в сообщении одна точка', () => {
    expect(checkRequired(51, { min: 1, max: 50 }, 'шт')).toBe('Не больше 50 шт.');
  });
});

describe('checkOptional', () => {
  it('пустое значение и ноль при min = 0 допустимы', () => {
    expect(checkOptional(null, { min: 0, max: 50 }, '%')).toBeNull();
    expect(checkOptional(0, { min: 0, max: 50 }, '%')).toBeNull();
  });

  it.each([
    [Number.NaN, 'Введите число.'],
    [-0.5, 'Значение не может быть отрицательным.'],
    [0.4, 'Не меньше 0,5 кг.'],
    [100.1, 'Не больше 100 кг.'],
  ])('%s → %s', (value, message) => {
    expect(checkOptional(value, { min: 0.5, max: 100 }, 'кг')).toBe(message);
  });

  it('ноль при min > 0 — ошибка нижней границы', () => {
    expect(checkOptional(0, { min: 0.5, max: 100 }, 'кг')).toBe('Не меньше 0,5 кг.');
  });
});

describe('fmt', () => {
  it('десятичная запятая без разделителей разрядов', () => {
    expect([fmt(0.1), fmt(10_000), fmt(43.2)]).toEqual(['0,1', '10000', '43,2']);
  });
});

describe('hasPrecision', () => {
  it('считает знаки после запятой с допуском на двоичные дроби', () => {
    expect(hasPrecision(7.5, 1)).toBe(true);
    expect(hasPrecision(0.1 + 0.2, 1)).toBe(true);
    expect(hasPrecision(7.55, 1)).toBe(false);
    expect(hasPrecision(0.85, 2)).toBe(true);
    expect(hasPrecision(0.855, 2)).toBe(false);
    expect(hasPrecision(2.7, 3)).toBe(true);
  });
});

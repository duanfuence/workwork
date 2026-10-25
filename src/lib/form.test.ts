import { describe, expect, it } from 'vitest';
import { parseNumberFields, withParseErrors, type Calculation } from './form';

const fields = ['a', 'b', 'c'] as const;
type Field = (typeof fields)[number];

describe('parseNumberFields', () => {
  it('разбирает числа, пустые поля и ошибки ввода', () => {
    expect(parseNumberFields(fields, { a: '2,5', b: '', c: 'abc' })).toEqual({
      values: { a: 2.5, b: null, c: null },
      errors: { c: 'Введите число.' },
    });
  });
});

describe('withParseErrors', () => {
  const ok: Calculation<Field, number> = { ok: true, result: 42 };
  const failed: Calculation<Field, number> = {
    ok: false,
    errors: { a: 'Заполните поле.', b: 'Не больше 10.' },
  };

  it('без ошибок разбора возвращает расчёт как есть', () => {
    expect(withParseErrors(ok, {})).toBe(ok);
  });

  it('ошибка разбора отменяет успешный расчёт', () => {
    expect(withParseErrors(ok, { c: 'Введите число.' })).toEqual({
      ok: false,
      errors: { c: 'Введите число.' },
    });
  });

  it('ошибка разбора заменяет ошибку расчёта того же поля и сохраняет остальные', () => {
    expect(withParseErrors(failed, { a: 'Введите число.' })).toEqual({
      ok: false,
      errors: { a: 'Введите число.', b: 'Не больше 10.' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { evaluatePaintForm, type PaintFormValues } from './paint-form';

const filled: PaintFormValues = {
  roomLength: '4',
  roomWidth: '3',
  wallHeight: '2,7',
  openingsArea: '3,9',
  ceiling: 'yes',
  coats: '2',
  coverage: '8',
  reserve: '10',
  canVolume: '2,7',
};

describe('evaluatePaintForm', () => {
  it('П5 через форму: десятичная запятая, 11,5 л, с запасом 12,7 л, 5 банок по 2,7 л', () => {
    const calculation = evaluatePaintForm(filled);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.liters, calculation.result.litersWithReserve]).toEqual([11.5, 12.7]);
    expect(calculation.result.cans).toBe(5);
  });

  it('пустые проёмы, запас и банка — 0 м², 0 % и без банок', () => {
    const calculation = evaluatePaintForm({
      ...filled,
      openingsArea: '',
      reserve: '',
      canVolume: '',
    });
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.openingsArea, calculation.result.reserve]).toEqual([0, 0]);
    expect(calculation.result.cans).toBeNull();
  });

  it('текст вместо числа — «Введите число.»; пустой выбор потолка — ошибка выбора', () => {
    expect(evaluatePaintForm({ ...filled, coverage: 'много' })).toEqual({
      ok: false,
      errors: { coverage: 'Введите число.' },
    });
    expect(evaluatePaintForm({ ...filled, ceiling: '' })).toEqual({
      ok: false,
      errors: { ceiling: 'Выберите, красить ли потолок.' },
    });
  });
});

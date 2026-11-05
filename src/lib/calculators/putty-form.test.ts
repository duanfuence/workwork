import { describe, expect, it } from 'vitest';
import { evaluatePuttyForm, type PuttyFormValues } from './putty-form';

const filled: PuttyFormValues = {
  wallLength: '4',
  wallHeight: '2,7',
  wallCount: '4',
  openingsArea: '3,9',
  layers: '2',
  consumption: '1,1',
  packMass: '20',
  reserve: '10',
  packPrice: '',
};

describe('evaluatePuttyForm', () => {
  it('Шп2 через форму: десятичная запятая, 86,5 кг, с запасом 95,2 кг, 5 упаковок по 20 кг', () => {
    const calculation = evaluatePuttyForm(filled);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.mass, calculation.result.massWithReserve]).toEqual([86.5, 95.2]);
    expect([calculation.result.packs, calculation.result.massToBuy]).toEqual([5, 100]);
  });

  it('пустые проёмы, запас и упаковка — 0 м², 0 % и без упаковок', () => {
    const calculation = evaluatePuttyForm({
      ...filled,
      openingsArea: '',
      reserve: '',
      packMass: '',
    });
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.openingsArea, calculation.result.reserve]).toEqual([0, 0]);
    expect([calculation.result.packs, calculation.result.massToBuy]).toEqual([null, null]);
  });

  it('текст вместо числа — «Введите число.»; пустые слои и расход — «Заполните поле.»', () => {
    expect(evaluatePuttyForm({ ...filled, layers: 'два' })).toEqual({
      ok: false,
      errors: { layers: 'Введите число.' },
    });
    expect(evaluatePuttyForm({ ...filled, layers: '', consumption: '' })).toEqual({
      ok: false,
      errors: { layers: 'Заполните поле.', consumption: 'Заполните поле.' },
    });
  });
});

describe('evaluatePuttyForm: режим «помещение»', () => {
  const room: PuttyFormValues = {
    ...filled,
    mode: 'room',
    roomLength: '4',
    roomWidth: '3',
    ceiling: 'yes',
  };

  it('Шп10 через форму: 101 кг, с запасом 111,1 кг, 6 упаковок по 20 кг', () => {
    const calculation = evaluatePuttyForm(room);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.mass, calculation.result.massWithReserve]).toEqual([101, 111.1]);
    expect(calculation.result.packs).toBe(6);
  });

  it('текст в скрытых полях стен не мешает расчёту помещения', () => {
    const calculation = evaluatePuttyForm({ ...room, wallLength: 'abc', wallCount: 'x' });
    expect(calculation.ok).toBe(true);
  });

  it('текст в поле помещения — «Введите число.»', () => {
    expect(evaluatePuttyForm({ ...room, roomWidth: 'три' })).toEqual({
      ok: false,
      errors: { roomWidth: 'Введите число.' },
    });
  });

  it('в режиме «стены» поля помещения не проверяются', () => {
    const calculation = evaluatePuttyForm({ ...room, mode: 'walls', roomLength: 'abc' });
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect(calculation.result.mass).toBe(86.5);
  });
});

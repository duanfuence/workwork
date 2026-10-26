import { describe, expect, it } from 'vitest';
import { evaluatePlasterForm, type PlasterFormValues } from './plaster-form';

const filled: PlasterFormValues = {
  wallLength: '4',
  wallHeight: '2,7',
  wallCount: '4',
  openingsArea: '3,9',
  thickness: '15',
  consumption: '0,85',
  reserve: '10',
  bagMass: '25',
};

describe('evaluatePlasterForm', () => {
  it('Ш2 через форму: десятичная запятая, 501,1 кг, с запасом 551,2 кг, 23 мешка по 25 кг', () => {
    const calculation = evaluatePlasterForm(filled);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.mass, calculation.result.massWithReserve]).toEqual([501.1, 551.2]);
    expect([calculation.result.bags, calculation.result.massToBuy]).toEqual([23, 575]);
  });

  it('пустые проёмы, запас и мешок — 0 м², 0 % и без мешков', () => {
    const calculation = evaluatePlasterForm({
      ...filled,
      openingsArea: '',
      reserve: '',
      bagMass: '',
    });
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.openingsArea, calculation.result.reserve]).toEqual([0, 0]);
    expect([calculation.result.bags, calculation.result.massToBuy]).toEqual([null, null]);
  });

  it('текст вместо числа — «Введите число.»; пустой расход — «Заполните поле.»', () => {
    expect(evaluatePlasterForm({ ...filled, thickness: 'толсто' })).toEqual({
      ok: false,
      errors: { thickness: 'Введите число.' },
    });
    expect(evaluatePlasterForm({ ...filled, consumption: '' })).toEqual({
      ok: false,
      errors: { consumption: 'Заполните поле.' },
    });
  });
});

describe('evaluatePlasterForm: режим «помещение»', () => {
  const room: PlasterFormValues = { ...filled, mode: 'room', roomLength: '4', roomWidth: '3' };

  it('Ш9 через форму: 432,3 кг, с запасом 475,5 кг, 20 мешков по 25 кг', () => {
    const calculation = evaluatePlasterForm(room);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.mass, calculation.result.massWithReserve]).toEqual([432.3, 475.5]);
    expect(calculation.result.bags).toBe(20);
  });

  it('текст в скрытых полях стен не мешает; в поле помещения — «Введите число.»', () => {
    expect(evaluatePlasterForm({ ...room, wallLength: 'abc' }).ok).toBe(true);
    expect(evaluatePlasterForm({ ...room, roomLength: '4м' })).toEqual({
      ok: false,
      errors: { roomLength: 'Введите число.' },
    });
  });
});

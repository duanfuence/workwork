import { describe, expect, it } from 'vitest';
import { evaluateTileForm, type TileFormValues } from './tile-form';

const filled: TileFormValues = {
  surface: 'wall',
  surfaceLength: '2,5',
  surfaceWidth: '2,7',
  surfaceCount: '2',
  tileLength: '600',
  tileWidth: '200',
  joint: '2',
  reserve: '10',
  tilesPerPack: '8',
  tilePrice: '',
  tilePriceUnit: 'm2',
};

describe('evaluateTileForm', () => {
  it('Т3 через форму: десятичная запятая — 140 плиток, 154 с запасом, 20 упаковок', () => {
    const calculation = evaluateTileForm(filled);
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.tiles, calculation.result.tilesWithReserve]).toEqual([140, 154]);
    expect(calculation.result.packs).toBe(20);
  });

  it('пустые шов, запас и упаковка — 0 мм, 0 %, без упаковок', () => {
    const calculation = evaluateTileForm({ ...filled, joint: '', reserve: '', tilesPerPack: '' });
    if (!calculation.ok) throw new Error(JSON.stringify(calculation.errors));
    expect([calculation.result.joint, calculation.result.reserve]).toEqual([0, 0]);
    expect(calculation.result.packs).toBeNull();
  });

  it('текст вместо числа — «Введите число.»; пустой тип — ошибка выбора', () => {
    expect(evaluateTileForm({ ...filled, joint: 'тонкий' })).toEqual({
      ok: false,
      errors: { joint: 'Введите число.' },
    });
    expect(evaluateTileForm({ ...filled, surface: '' })).toEqual({
      ok: false,
      errors: { surface: 'Выберите тип поверхности.' },
    });
  });
});

describe('цена плитки в форме', () => {
  it('Т7 через форму: «1 250» за м² — 24 000 ₽; «1 890» за упаковку — 37 800 ₽', () => {
    const perM2 = evaluateTileForm({ ...filled, tilePrice: '1 250' });
    const perPack = evaluateTileForm({ ...filled, tilePrice: '1 890', tilePriceUnit: 'pack' });
    expect(perM2.ok && perM2.result.totalCost).toBe(24_000);
    expect(perPack.ok && perPack.result.totalCost).toBe(37_800);
  });
});

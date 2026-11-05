import { describe, expect, it } from 'vitest';
import { presetTypicalRange } from '../data/material-presets';
import { parseTypicalRange, typicalWarning } from './typical-value';

describe('разброс марок для предупреждения', () => {
  it('из данных ориентиров: краска 7–14 м²/л, штукатурка 0,8–1,8, шпаклёвка 0,8–1,7', () => {
    expect(presetTypicalRange('paint')).toEqual({
      min: 7,
      max: 14,
      unit: 'м²/л',
      lowFactor: 1.5,
      highFactor: 1.5,
      where: 'этикетку',
    });
    expect([presetTypicalRange('plaster').min, presetTypicalRange('plaster').max]).toEqual([
      0.8, 1.8,
    ]);
    expect(presetTypicalRange('putty')).toMatchObject({ min: 0.8, max: 1.7, highFactor: null });
  });
});

describe('предупреждение о нетипичном значении', () => {
  const paint = presetTypicalRange('paint');

  it('укрывистость 1 м²/л — «Обычно 7–14 м²/л — проверьте этикетку.»', () => {
    expect(typicalWarning(paint, '1')).toBe('Обычно 7–14 м²/л — проверьте этикетку.');
  });

  it('порог снизу — меньше 7 ÷ 1,5 ≈ 4,67; сверху — больше 14 × 1,5 = 21', () => {
    expect(typicalWarning(paint, '4,6')).not.toBeNull();
    expect(typicalWarning(paint, '4,7')).toBeNull();
    expect(typicalWarning(paint, '21')).toBeNull();
    expect(typicalWarning(paint, '21,1')).not.toBeNull();
  });

  it('в разбросе и чуть за ним — без предупреждения', () => {
    for (const value of ['5', '7', '10', '14', '18'])
      expect(typicalWarning(paint, value)).toBeNull();
  });

  it('пусто, текст, ноль и отрицательное — без предупреждения: это проверяет само поле', () => {
    for (const value of ['', 'abc', '0', '-3']) expect(typicalWarning(paint, value)).toBeNull();
  });

  it('штукатурка: 0,3 кг — предупреждение «проверьте упаковку», 3 кг — тоже', () => {
    const plaster = presetTypicalRange('plaster');
    expect(typicalWarning(plaster, '0,3')).toBe(
      'Обычно 0,8–1,8 кг/м² на 1 мм — проверьте упаковку.',
    );
    expect(typicalWarning(plaster, '3')).not.toBeNull();
    expect(typicalWarning(plaster, '1,2')).toBeNull();
  });

  it('шпаклёвка: только снизу — толстый слой даёт большой расход на слой', () => {
    const putty = presetTypicalRange('putty');
    expect(typicalWarning(putty, '0,4')).not.toBeNull();
    expect(typicalWarning(putty, '5')).toBeNull();
  });
});

describe('разбор data-typical', () => {
  it('круговая проверка: JSON из разметки → тот же разброс', () => {
    const range = presetTypicalRange('putty');
    expect(parseTypicalRange(JSON.stringify(range))).toEqual(range);
  });

  it('нет атрибута, повреждённый JSON или неверные поля — без предупреждений', () => {
    expect(parseTypicalRange(undefined)).toBeNull();
    expect(parseTypicalRange('{')).toBeNull();
    expect(parseTypicalRange('null')).toBeNull();
    expect(
      parseTypicalRange(
        '{"min":-1,"max":2,"unit":"x","lowFactor":1.5,"highFactor":null,"where":"y"}',
      ),
    ).toBeNull();
    expect(
      parseTypicalRange(
        '{"min":1,"max":2,"unit":"x","lowFactor":1.5,"highFactor":"2","where":"y"}',
      ),
    ).toBeNull();
  });
});

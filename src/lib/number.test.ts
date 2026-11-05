import { describe, expect, it } from 'vitest';
import { ceilDiv, ceilToMultiple, centimetersToMm, metersToMm, parseDecimal } from './number';

describe('parseDecimal', () => {
  it.each([
    ['2.5', 2.5],
    ['2,5', 2.5],
    [' 3 ', 3],
    ['10 050', 10050],
    ['1\u00a0299,90', 1299.9],
    ['0,53', 0.53],
    ['.5', 0.5],
    ['5.', 5],
    ['-1', -1],
    ['0', 0],
  ])('«%s» → %d', (raw, expected) => {
    expect(parseDecimal(raw)).toEqual({ kind: 'number', value: expected });
  });

  it.each(['', '   '])('пустая строка «%s» → empty', (raw) => {
    expect(parseDecimal(raw)).toEqual({ kind: 'empty' });
  });

  it.each(['abc', '2,5,1', '2.5.1', '1e3', 'Infinity', 'NaN', '--1', '2 м', ',', '.'])(
    '«%s» → invalid',
    (raw) => {
      expect(parseDecimal(raw)).toEqual({ kind: 'invalid' });
    },
  );
});

describe('ceilDiv', () => {
  it('делит нацело с округлением вверх', () => {
    expect(ceilDiv(14000, 530)).toBe(27);
    expect(ceilDiv(12720, 530)).toBe(24);
    expect(ceilDiv(12721, 530)).toBe(25);
    expect(ceilDiv(0, 530)).toBe(0);
  });
});

describe('ceilToMultiple', () => {
  it('округляет вверх до кратного шагу', () => {
    expect(ceilToMultiple(2600, 640)).toBe(3200);
    expect(ceilToMultiple(2560, 640)).toBe(2560);
    expect(ceilToMultiple(2400, 640)).toBe(2560);
  });
});

describe('перевод единиц', () => {
  it('не накапливает ошибку двоичной дроби', () => {
    // 0.53 * 1000 = 530.0000000000001 в двоичной арифметике
    expect(metersToMm(0.53)).toBe(530);
    expect(metersToMm(10.05)).toBe(10050);
    expect(metersToMm(3.18)).toBe(3180);
    expect(centimetersToMm(64)).toBe(640);
    expect(centimetersToMm(0.5)).toBe(5);
  });
});

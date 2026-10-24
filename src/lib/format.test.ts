import { describe, expect, it } from 'vitest';
import { formatNumber, formatRubles } from './format';

// В ru-RU разряды разделяются неразрывным пробелом (U+00A0).
const nbsp = '\u00a0';

describe('formatNumber', () => {
  it('использует десятичную запятую и отбрасывает лишние нули', () => {
    expect(formatNumber(2.6)).toBe('2,6');
    expect(formatNumber(14)).toBe('14');
    expect(formatNumber(48.6)).toBe('48,6');
    expect(formatNumber(2.565, 3)).toBe('2,565');
  });

  it('разделяет разряды неразрывным пробелом', () => {
    expect(formatNumber(11699.1)).toBe(`11${nbsp}699,1`);
  });
});

describe('formatRubles', () => {
  it('показывает копейки только при их наличии', () => {
    expect(formatRubles(11699.1)).toBe(`11${nbsp}699,10${nbsp}₽`);
    expect(formatRubles(7200)).toBe(`7${nbsp}200${nbsp}₽`);
    expect(formatRubles(0)).toBe(`0${nbsp}₽`);
  });
});

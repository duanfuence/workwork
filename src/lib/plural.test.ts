import { describe, expect, it } from 'vitest';
import { calculatorWordForms, pluralizeRu } from './plural';

describe('pluralizeRu', () => {
  it.each([
    [0, 'калькуляторов'],
    [1, 'калькулятор'],
    [2, 'калькулятора'],
    [4, 'калькулятора'],
    [5, 'калькуляторов'],
    [11, 'калькуляторов'],
    [12, 'калькуляторов'],
    [14, 'калькуляторов'],
    [21, 'калькулятор'],
    [22, 'калькулятора'],
    [101, 'калькулятор'],
    [111, 'калькуляторов'],
  ])('%i → %s', (count, expected) => {
    expect(pluralizeRu(count, calculatorWordForms)).toBe(expected);
  });
});

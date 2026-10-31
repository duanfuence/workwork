import { describe, expect, it } from 'vitest';
import {
  activeChoice,
  choiceAfterEdit,
  customChoice,
  fieldTextForChoice,
  median,
  presetFieldText,
  presetValueByRule,
  type PresetChoice,
} from './presets';

const choices: PresetChoice[] = [
  { id: 'gypsum', fieldText: '1,3' },
  { id: 'cement', fieldText: '1,8' },
  { id: 'start', fieldText: '1' },
  { id: 'finish', fieldText: '1' },
];

describe('presetFieldText', () => {
  it('десятичная запятая, без лишних нулей', () => {
    expect([presetFieldText(1.3), presetFieldText(7), presetFieldText(1)]).toEqual([
      '1,3',
      '7',
      '1',
    ]);
  });
});

describe('выбор типа', () => {
  it('подставляет значение ориентира', () => {
    expect(fieldTextForChoice(choices, 'cement')).toBe('1,8');
  });

  it('«Своё значение» и неизвестный тип поле не меняют', () => {
    expect(fieldTextForChoice(choices, customChoice)).toBeNull();
    expect(fieldTextForChoice(choices, 'nope')).toBeNull();
  });

  it('после подстановки ориентир активен', () => {
    expect(activeChoice(choices, 'gypsum', '1,3')?.id).toBe('gypsum');
  });
});

describe('ручная правка', () => {
  it('другое число — «Своё значение», пометка ориентира пропадает', () => {
    expect(choiceAfterEdit(choices, 'gypsum', '0,9')).toBe(customChoice);
    expect(activeChoice(choices, 'gypsum', '0,9')).toBeNull();
  });

  it('то же число в другой записи — тип сохраняется', () => {
    expect(choiceAfterEdit(choices, 'gypsum', '1.30')).toBe('gypsum');
    expect(choiceAfterEdit(choices, 'gypsum', ' 1,3 ')).toBe('gypsum');
  });

  it('пустое поле и текст — «Своё значение»', () => {
    expect(choiceAfterEdit(choices, 'gypsum', '')).toBe(customChoice);
    expect(choiceAfterEdit(choices, 'gypsum', 'много')).toBe(customChoice);
  });

  it('у двух типов одно значение — сохраняется выбранный, а не первый подходящий', () => {
    expect(choiceAfterEdit(choices, 'finish', '1')).toBe('finish');
  });

  it('при «Своём значении» совпадение с ориентиром тип не включает', () => {
    expect(choiceAfterEdit(choices, customChoice, '1,3')).toBe(customChoice);
  });
});

describe('сброс', () => {
  it('исходное состояние — «Своё значение» и пустое поле, ориентира нет', () => {
    expect(activeChoice(choices, customChoice, '')).toBeNull();
  });
});

describe('median', () => {
  it('нечётное и чётное число значений', () => {
    expect(median([0.9, 1, 1])).toBe(1);
    expect(median([1.3, 0.85, 1, 0.9])).toBeCloseTo(0.95, 10);
  });

  it('пустой список — ошибка', () => {
    expect(() => median([])).toThrow();
  });
});

describe('presetValueByRule', () => {
  const sources = (pairs: [number, number][]) => pairs.map(([min, max]) => ({ min, max }));

  it('расход: медиана верхних границ, вверх до 0,1 — 0,95 → 1,0 (не 1,1 из-за двоичной дроби)', () => {
    expect(
      presetValueByRule(
        'consumption',
        sources([
          [0.85, 0.85],
          [1, 1],
          [0.8, 0.9],
          [1.1, 1.3],
        ]),
      ),
    ).toBe(1);
  });

  it('расход: точная медиана не округляется, 1,65 → 1,7', () => {
    expect(
      presetValueByRule(
        'consumption',
        sources([
          [1.5, 1.6],
          [1.6, 1.6],
          [1.4, 1.8],
          [1.4, 1.5],
        ]),
      ),
    ).toBe(1.6);
    expect(
      presetValueByRule(
        'consumption',
        sources([
          [1.6, 1.6],
          [1.7, 1.7],
        ]),
      ),
    ).toBe(1.7);
  });

  it('укрывистость: медиана нижних границ, вниз до целого — 7,75 → 7', () => {
    expect(
      presetValueByRule(
        'coverage',
        sources([
          [7, 14],
          [7, 12],
          [8.5, 9],
          [12, 12],
        ]),
      ),
    ).toBe(7);
    expect(
      presetValueByRule(
        'coverage',
        sources([
          [8, 10],
          [9, 12],
          [10, 14],
        ]),
      ),
    ).toBe(9);
  });
});

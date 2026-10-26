import { describe, expect, it } from 'vitest';
import {
  activeChoice,
  choiceAfterEdit,
  customChoice,
  fieldTextForChoice,
  presetFieldText,
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

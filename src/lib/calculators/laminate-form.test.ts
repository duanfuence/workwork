import { describe, expect, it } from 'vitest';
import { evaluateLaminateForm, type LaminateFormValues } from './laminate-form';

const filled: LaminateFormValues = {
  roomLength: '4',
  roomWidth: '3,5',
  boardLength: '1380',
  boardWidth: '193',
  boardsPerPack: '8',
  direction: 'length',
  scheme: 'half',
  minPiece: '',
  minOffset: '',
  reserve: '5',
  packPrice: '',
};

describe('evaluateLaminateForm', () => {
  it('К13 с запасом 5 % и пустыми требованиями (по умолчанию 400 мм): 57 досок, 60 с запасом, 8 упаковок', () => {
    const calculation = evaluateLaminateForm(filled);
    expect(calculation.ok).toBe(true);
    if (calculation.ok) {
      expect(calculation.result.minPiece).toBe(400);
      expect(calculation.result.boards).toBe(57);
      expect(calculation.result.boardsWithReserve).toBe(60);
      expect(calculation.result.packs).toBe(8);
    }
  });

  it('текст вместо числа — «Введите число.», а не «Заполните поле.»', () => {
    expect(evaluateLaminateForm({ ...filled, boardLength: 'длинная' })).toEqual({
      ok: false,
      errors: { boardLength: 'Введите число.' },
    });
  });

  it('пустые направление и схема — ошибки выбора', () => {
    const calculation = evaluateLaminateForm({ ...filled, direction: '', scheme: '' });
    expect(calculation).toEqual({
      ok: false,
      errors: { direction: 'Выберите направление.', scheme: 'Выберите схему.' },
    });
  });
});

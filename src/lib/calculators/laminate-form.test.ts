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
  gap: '',
  kerf: '',
  reserve: '5',
  packPrice: '',
};

describe('evaluateLaminateForm', () => {
  // Пустые поля — значения по умолчанию: m = o = 400, зазор 8, пропил 3. Вручную (§15): поле 3984 × 3484,
  // 19 рядов (последний 10 мм); начала 1380 и 690, концы 1224 и 534; пары 690 + 534 + 3 = 1227 ≤ 1380 —
  // 38 + 9 + 19 − 9 = 57 досок, как и без зазора.
  it('К13 с запасом 5 % и пустыми требованиями (400 мм, зазор 8, пропил 3): 57 досок, 60 с запасом, 8 упаковок', () => {
    const calculation = evaluateLaminateForm(filled);
    expect(calculation.ok).toBe(true);
    if (calculation.ok) {
      expect(calculation.result.minPiece).toBe(400);
      expect(calculation.result.boards).toBe(57);
      expect(calculation.result.boardsWithReserve).toBe(60);
      expect(calculation.result.packs).toBe(8);
    }
  });

  it('пустые зазор и пропил — 8 и 3 мм; в результате те же значения и поле 3984 × 3484 мм', () => {
    const calculation = evaluateLaminateForm(filled);
    if (!calculation.ok) throw new Error('ожидался расчёт');
    expect([calculation.result.gap, calculation.result.kerf]).toEqual([8, 3]);
    expect([calculation.result.rowLength, calculation.result.fieldWidth]).toEqual([3984, 3484]);
    expect([calculation.result.roomLengthMm, calculation.result.roomWidthMm]).toEqual([4000, 3500]);
    expect([calculation.result.rows, calculation.result.lastRowWidth]).toEqual([19, 10]);
  });

  it('введённые зазор и пропил передаются в расчёт как есть: «0» и «2,3» (без округления)', () => {
    const calculation = evaluateLaminateForm({ ...filled, gap: '0', kerf: '2,3' });
    if (!calculation.ok) throw new Error('ожидался расчёт');
    expect([calculation.result.gap, calculation.result.kerf]).toEqual([0, 2.3]);
    expect(calculation.result.rowLength).toBe(4000);
    const wide = evaluateLaminateForm({ ...filled, gap: '30', kerf: '5' });
    if (!wide.ok) throw new Error('ожидался расчёт');
    expect([wide.result.gap, wide.result.kerf, wide.result.rowLength]).toEqual([30, 5, 3940]);
  });

  it('ошибки зазора и пропила — у своих полей, расчёт не выполняется', () => {
    expect(evaluateLaminateForm({ ...filled, gap: '8,5' })).toEqual({
      ok: false,
      errors: { gap: 'Введите целое число миллиметров.' },
    });
    expect(evaluateLaminateForm({ ...filled, gap: '31', kerf: '5,1' })).toEqual({
      ok: false,
      errors: { gap: 'Не больше 30 мм.', kerf: 'Не больше 5 мм.' },
    });
    expect(evaluateLaminateForm({ ...filled, kerf: '2,35' })).toEqual({
      ok: false,
      errors: { kerf: 'Не больше одного знака после запятой.' },
    });
    expect(evaluateLaminateForm({ ...filled, kerf: 'тонкий' })).toEqual({
      ok: false,
      errors: { kerf: 'Введите число.' },
    });
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

import { describe, expect, it } from 'vitest';
import {
  keyboardLikelyOpen,
  resultAnnouncement,
  resultBarInvalidText,
  resultBarView,
  resultInView,
  type ResultBarInput,
} from './result-bar';

const shown: ResultBarInput = {
  calculated: true,
  state: 'ready',
  narrow: true,
  resultInView: false,
  keyboardOpen: false,
  summary: '11,9 л краски',
};

describe('панель итога', () => {
  it('после расчёта, на узком экране и вне видимости результата — итог', () => {
    expect(resultBarView(shown)).toEqual({ visible: true, tone: 'ready', text: '11,9 л краски' });
  });

  it('до первого успешного расчёта и после «Сбросить» — нет', () => {
    expect(resultBarView({ ...shown, calculated: false })).toEqual({ visible: false });
    expect(resultBarView({ ...shown, calculated: false, state: 'invalid' })).toEqual({
      visible: false,
    });
    expect(resultBarView({ ...shown, state: 'empty' })).toEqual({ visible: false });
  });

  it('результат на экране — нет', () => {
    expect(resultBarView({ ...shown, resultInView: true })).toEqual({ visible: false });
  });

  it('широкий экран (≥ 960 px) — нет', () => {
    expect(resultBarView({ ...shown, narrow: false })).toEqual({ visible: false });
  });

  it('открыта клавиатура — нет', () => {
    expect(resultBarView({ ...shown, keyboardOpen: true })).toEqual({ visible: false });
  });

  it('ошибки в полях — «Исправьте значения в полях», а не устаревший итог', () => {
    expect(resultBarView({ ...shown, state: 'invalid' })).toEqual({
      visible: true,
      tone: 'invalid',
      text: resultBarInvalidText,
    });
    expect(resultBarInvalidText).toBe('Исправьте значения в полях');
  });

  it('пустой итог — панели нет, а не пустая кнопка', () => {
    expect(resultBarView({ ...shown, summary: '' })).toEqual({ visible: false });
  });
});

describe('экранная клавиатура', () => {
  it('фокус в поле и видимая область ниже 75 % окна — открыта', () => {
    // 390 × 844: окно 750 px, клавиатура ~330 px — видно 420 px.
    expect(keyboardLikelyOpen(true, 420, 750)).toBe(true);
  });

  it('без фокуса в поле или при небольшом уменьшении (адресная строка) — нет', () => {
    expect(keyboardLikelyOpen(false, 420, 750)).toBe(false);
    expect(keyboardLikelyOpen(true, 694, 750)).toBe(false);
    expect(keyboardLikelyOpen(true, 750, 750)).toBe(false);
  });

  it('граница — ровно 75 % ещё не клавиатура', () => {
    expect(keyboardLikelyOpen(true, 562.5, 750)).toBe(false);
    expect(keyboardLikelyOpen(true, 562, 750)).toBe(true);
  });

  it('неизвестная высота окна — нет', () => {
    expect(keyboardLikelyOpen(true, 0, 0)).toBe(false);
  });
});

describe('объявление результата', () => {
  it('итог — с пометкой «Результат»', () => {
    expect(resultAnnouncement('ready', '11,9 л краски · 3 банки')).toBe(
      'Результат: 11,9 л краски · 3 банки',
    );
  });

  it('ошибки — короткое сообщение; до расчёта и без итога — ничего', () => {
    expect(resultAnnouncement('invalid', '')).toBe(
      'Расчёт не выполнен: исправьте значения в полях.',
    );
    expect(resultAnnouncement('empty', '11,9 л')).toBe('');
    expect(resultAnnouncement('ready', '')).toBe('');
  });
});

describe('результат на экране', () => {
  // Окно 750 px: видимая полоса — от 64 (под шапкой) до 670 (над панелью итога).
  it('целиком в полосе — виден', () => {
    expect(resultInView(300, 348, 750)).toBe(true);
  });

  it('ниже панели или под шапкой — не виден', () => {
    expect(resultInView(700, 748, 750)).toBe(false);
    expect(resultInView(10, 50, 750)).toBe(false);
    expect(resultInView(-200, -152, 750)).toBe(false);
  });

  it('видна половина высоты — виден, меньше — нет', () => {
    expect(resultInView(646, 694, 750)).toBe(true); // 24 из 48 px
    expect(resultInView(647, 695, 750)).toBe(false);
  });

  it('скрытый элемент (нулевая высота) — не виден', () => {
    expect(resultInView(0, 0, 750)).toBe(false);
  });
});

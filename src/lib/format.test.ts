import { describe, expect, it } from 'vitest';
import { formatNumber, formatRubles, listRu, typograph } from './format';

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

describe('listRu', () => {
  it('перечисляет через запятую с «и» перед последним', () => {
    expect(listRu([])).toBe('');
    expect(listRu(['обои'])).toBe('обои');
    expect(listRu(['обои', 'краска'])).toBe('обои и краска');
    expect(listRu(['обои', 'ламинат', 'краска'])).toBe('обои, ламинат и краска');
  });
});

describe('typograph', () => {
  it('неразрывный пробел перед тире: строка не начинается с «—»', () => {
    expect(typograph('Сколько купить — и из чего')).toBe(
      `Сколько купить${nbsp}— и${nbsp}из${nbsp}чего`,
    );
    expect(typograph('с запасом 10 % — 101 л.')).toBe(
      `с${nbsp}запасом 10${nbsp}%${nbsp}— 101${nbsp}л.`,
    );
  });

  it('число и единица, знак или слово — не разрываются', () => {
    expect(typograph('10 % 66 м² 2,7 л 25 кг 14 шт. 5 банок 1 200 ₽')).toBe(
      `10${nbsp}% 66${nbsp}м² 2,7${nbsp}л 25${nbsp}кг 14${nbsp}шт. 5${nbsp}банок 1 200${nbsp}₽`,
    );
  });

  it('после коротких предлогов и союзов, в том числе с заглавной и подряд', () => {
    expect(typograph('В комнате и в коридоре на 1 мм')).toBe(
      `В${nbsp}комнате и${nbsp}в${nbsp}коридоре на${nbsp}1${nbsp}мм`,
    );
    expect(typograph('ширина (по полу)')).toBe(`ширина (по${nbsp}полу)`);
  });

  it('не трогает слова, которые начинаются как предлог, диапазоны и уже набранный текст', () => {
    expect(typograph('Площадь вычитается')).toBe('Площадь вычитается');
    expect(typograph('обычно 7–14 м²/л')).toBe(`обычно 7–14${nbsp}м²/л`);
    expect(typograph(typograph('и в 10 %'))).toBe(typograph('и в 10 %'));
    expect(typograph('')).toBe('');
  });
});

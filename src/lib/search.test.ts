import { describe, expect, it } from 'vitest';
import { calculators } from '../data/calculators';
import { matchesQuery, normalizeSearchText, searchCatalog } from './search';

const ids = (query: string) => searchCatalog(calculators, query).map((entry) => entry.id);

describe('normalizeSearchText', () => {
  it('приводит к нижнему регистру, заменяет «ё» и убирает знаки препинания', () => {
    expect(normalizeSearchText('  Шпаклёвка, ГИПС!  ')).toBe('шпаклевка гипс');
    expect(normalizeSearchText('м²/расход')).toBe('м2 расход');
    // «ё», набранная как «е» + комбинируемый знак U+0308
    expect(normalizeSearchText('шпакле\u0308вка')).toBe('шпаклевка');
  });
});

describe('matchesQuery', () => {
  it('пустой запрос подходит всегда', () => {
    expect(matchesQuery('обои стены', '')).toBe(true);
    expect(matchesQuery('обои стены', '   ')).toBe(true);
  });

  it('сравнивает по началу слов, а не по любой подстроке', () => {
    expect(matchesQuery('калькулятор плитки', 'плит')).toBe(true);
    expect(matchesQuery('калькулятор плитки', 'итк')).toBe(false);
  });

  it('требует совпадения каждого слова запроса', () => {
    expect(matchesQuery('ламинат пол', 'ламинат пол')).toBe(true);
    expect(matchesQuery('ламинат пол', 'ламинат потолок')).toBe(false);
  });
});

describe('searchCatalog на реальном каталоге', () => {
  it('находит калькулятор по началу названия', () => {
    expect(ids('плит')).toEqual(['tile']);
    expect(ids('Ламинат')).toEqual(['laminate']);
  });

  it('не различает «е» и «ё» и находит разговорные формы', () => {
    expect(ids('шпаклевка')).toEqual(['putty']);
    expect(ids('шпатлевка')).toEqual(['putty']);
  });

  it('находит по синонимам и материалам', () => {
    expect(ids('кафель')).toEqual(['tile']);
    expect(ids('рулоны')).toEqual(['wallpaper']);
  });

  it('по общему слову возвращает несколько калькуляторов', () => {
    expect(ids('стены')).toEqual(
      expect.arrayContaining(['wallpaper', 'paint', 'putty', 'plaster']),
    );
  });

  it('возвращает пустой список, если совпадений нет', () => {
    expect(ids('бетон')).toEqual([]);
    expect(ids('qwerty')).toEqual([]);
  });

  it('пустой запрос возвращает весь каталог', () => {
    expect(ids('')).toHaveLength(calculators.length);
  });
});

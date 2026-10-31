import { describe, expect, it } from 'vitest';
import {
  buildShareQuery,
  parseShareQuery,
  shareText,
  startValues,
  type ShareControl,
  type ShareValue,
} from './share-link';

const controls: ShareControl[] = [
  { name: 'mode', kind: 'choice', options: ['room', 'walls'] },
  { name: 'roomLength', kind: 'number' },
  { name: 'roomWidth', kind: 'number' },
  { name: 'wallHeight', kind: 'number' },
  { name: 'openingsArea', kind: 'number' },
  { name: 'consumption', kind: 'number' },
  { name: 'consumptionPreset', kind: 'choice', options: ['', 'putty-gypsum-finish'] },
];

const form: ShareValue[] = [
  { name: 'mode', kind: 'choice', value: 'room' },
  { name: 'roomLength', kind: 'number', value: '4' },
  { name: 'roomWidth', kind: 'number', value: '3,5' },
  { name: 'wallHeight', kind: 'number', value: '2,70' },
  { name: 'openingsArea', kind: 'number', value: '' },
  { name: 'consumption', kind: 'number', value: '0,9' },
  { name: 'consumptionPreset', kind: 'choice', value: 'putty-gypsum-finish' },
];

describe('ссылка на расчёт', () => {
  it('короткий формат: версия, имена полей, числа с точкой; пустое поле — пустым значением', () => {
    expect(buildShareQuery(form)).toBe(
      'v=1&mode=room&roomLength=4&roomWidth=3.5&wallHeight=2.7&openingsArea=&consumption=0.9&consumptionPreset=putty-gypsum-finish',
    );
  });

  it('круговая проверка: форма → ссылка → форма (числа в виде поля)', () => {
    expect(parseShareQuery(`?${buildShareQuery(form)}`, controls)).toEqual({
      mode: 'room',
      roomLength: '4',
      roomWidth: '3,5',
      wallHeight: '2,7',
      openingsArea: '',
      consumption: '0,9',
      consumptionPreset: 'putty-gypsum-finish',
    });
  });

  it('пробелы в разрядах и запятая — как в поле; текст вместо числа в ссылку не попадает', () => {
    expect(
      buildShareQuery([
        { name: 'roomLength', kind: 'number', value: '1 000,5' },
        { name: 'roomWidth', kind: 'number', value: 'три' },
      ]),
    ).toBe('v=1&roomLength=1000.5');
  });

  it('без версии или другая версия — не ссылка на расчёт', () => {
    expect(parseShareQuery('?roomLength=4', controls)).toBeNull();
    expect(parseShareQuery('?v=2&roomLength=4', controls)).toBeNull();
    expect(parseShareQuery('', controls)).toBeNull();
  });

  it('неверные и лишние параметры молча пропускаются', () => {
    expect(
      parseShareQuery(
        '?v=1&roomLength=abc&roomWidth=3&mode=ceiling&utm_source=x&wallHeight=' +
          '1'.repeat(40) +
          '&consumptionPreset=<script>&openingsArea=%20',
        controls,
      ),
    ).toEqual({ roomWidth: '3', openingsArea: '' });
  });

  it('отрицательное и запредельное число читается — его отклонит обычная проверка поля', () => {
    expect(parseShareQuery('?v=1&roomLength=-5&roomWidth=1000', controls)).toEqual({
      roomLength: '-5',
      roomWidth: '1000',
    });
  });

  it('значения из ссылки важнее сохранённых размеров комнаты', () => {
    const remembered = { roomLength: '4', roomWidth: '3', wallHeight: '2,7' };
    expect(startValues({ roomLength: '5', consumption: '1' }, remembered)).toEqual({
      source: 'link',
      values: { roomLength: '5', consumption: '1' },
    });
    expect(startValues({}, remembered)).toEqual({ source: 'memory', values: remembered });
    expect(startValues(null, remembered)).toEqual({ source: 'memory', values: remembered });
    expect(startValues(null, {})).toEqual({ source: 'none', values: {} });
  });
});

describe('текст итога', () => {
  it('список покупок: позиция с квадратом-галочкой, исходные данные, ссылка', () => {
    expect(
      shareText({
        title: 'Калькулятор краски',
        params: ['Площадь окрашивания 37,8 м²', '2 слоя, укрывистость 7 м²/л, запас 10 %'],
        purchase: '5 банок по 2,7 л — нужно 12,7 л',
        url: 'https://example.com/kalkulyatory/kraska/?v=1&roomLength=4',
      }),
    ).toBe(
      [
        'Список покупок · Калькулятор краски (ДомРасчёт)',
        '□ 5 банок по 2,7 л — нужно 12,7 л',
        '',
        'Исходные данные:',
        '— Площадь окрашивания 37,8 м²',
        '— 2 слоя, укрывистость 7 м²/л, запас 10 %',
        '',
        'Расчёт с формулами: https://example.com/kalkulyatory/kraska/?v=1&roomLength=4',
      ].join('\n'),
    );
  });
});

describe('стоимость в ссылке и списке покупок (D-033)', () => {
  const priced: ShareControl[] = [
    { name: 'canVolume', kind: 'number' },
    { name: 'canPrice', kind: 'number' },
    { name: 'tilePriceUnit', kind: 'choice', options: ['m2', 'pack'] },
  ];

  it('цена с пробелом в разрядах и копейками — в ссылке числом с точкой, обратно — как в поле', () => {
    const query = buildShareQuery([
      { name: 'canVolume', kind: 'number', value: '2,7' },
      { name: 'canPrice', kind: 'number', value: '2 379,99' },
      { name: 'tilePriceUnit', kind: 'choice', value: 'pack' },
    ]);
    expect(query).toBe('v=1&canVolume=2.7&canPrice=2379.99&tilePriceUnit=pack');
    expect(parseShareQuery(`?${query}`, priced)).toEqual({
      canVolume: '2,7',
      canPrice: '2379,99',
      tilePriceUnit: 'pack',
    });
  });

  it('пустая цена — пустым значением; неизвестная единица цены пропускается', () => {
    expect(parseShareQuery('?v=1&canPrice=&tilePriceUnit=kg', priced)).toEqual({ canPrice: '' });
  });

  it('стоимость — строкой под позицией списка покупок', () => {
    expect(
      shareText({
        title: 'Калькулятор краски',
        params: ['Площадь окрашивания 45,9 м²'],
        purchase: '5 банок по 2,7 л — нужно 12,7 л',
        cost: 'Стоимость ≈ 11 900 ₽ (5 банок × 2 380 ₽)',
        url: 'https://example.com/kalkulyatory/kraska/?v=1',
      })
        .split('\n')
        .slice(1, 3),
    ).toEqual(['□ 5 банок по 2,7 л — нужно 12,7 л', 'Стоимость ≈ 11 900 ₽ (5 банок × 2 380 ₽)']);
  });
});

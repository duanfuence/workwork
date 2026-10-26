import { describe, expect, it } from 'vitest';
import { parseSiteUrl } from './site-url';

describe('parseSiteUrl', () => {
  it('без значения — адреса нет', () => {
    expect(parseSiteUrl(undefined)).toBeUndefined();
    expect(parseSiteUrl('')).toBeUndefined();
    expect(parseSiteUrl('   ')).toBeUndefined();
  });

  it('https-адрес без пути — origin без слэша на конце', () => {
    expect(parseSiteUrl('https://example.com')).toBe('https://example.com');
    expect(parseSiteUrl('https://example.com/')).toBe('https://example.com');
    expect(parseSiteUrl(' https://Example.COM ')).toBe('https://example.com');
    expect(parseSiteUrl('https://xn--80aswg.xn--p1ai')).toBe('https://xn--80aswg.xn--p1ai');
  });

  it.each([
    ['example.com', 'это не абсолютный адрес'],
    ['/kalkulyatory/', 'это не абсолютный адрес'],
    ['http://example.com', 'нужен протокол https'],
    ['ftp://example.com', 'нужен протокол https'],
    ['https://user:pass@example.com', 'логин и пароль в адресе недопустимы'],
    ['https://example.com/site', 'адрес не должен содержать путь'],
    ['https://example.com/site/', 'адрес не должен содержать путь'],
    ['https://example.com/?a=1', 'адрес не должен содержать параметры'],
    ['https://example.com/?', 'адрес не должен содержать параметры'],
    ['https://example.com/#top', 'адрес не должен содержать якорь'],
  ])('%s — ошибка «%s»', (raw, reason) => {
    expect(() => parseSiteUrl(raw)).toThrow(`SITE_URL задан неверно: «${raw}» — ${reason}`);
  });
});

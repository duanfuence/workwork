import { describe, expect, it } from 'vitest';
import { evaluateWallpaperForm, type WallpaperFormValues } from './wallpaper-form';

const empty: WallpaperFormValues = {
  roomLength: '',
  roomWidth: '',
  wallHeight: '',
  windowCount: '',
  windowWidth: '',
  windowHeight: '',
  doorCount: '',
  doorWidth: '',
  doorHeight: '',
  rollWidth: '',
  rollLength: '',
  patternRepeat: '',
  trimAllowance: '',
  rollPrice: '',
};

const filled: WallpaperFormValues = {
  ...empty,
  roomLength: '4',
  roomWidth: '3',
  wallHeight: '2,5',
  rollWidth: '0,53',
  rollLength: '10,05',
  trimAllowance: '10',
};

describe('evaluateWallpaperForm', () => {
  it('понимает десятичную запятую и считает пример 1', () => {
    const calculation = evaluateWallpaperForm(filled);
    expect(calculation.ok && calculation.result.rolls).toBe(10); // аудит: 28 полос по стенам
  });

  it('пустая форма — ошибки во всех обязательных полях', () => {
    const calculation = evaluateWallpaperForm(empty);
    expect(calculation.ok).toBe(false);
    if (!calculation.ok) {
      expect(Object.keys(calculation.errors).sort()).toEqual(
        ['roomLength', 'roomWidth', 'rollLength', 'rollWidth', 'wallHeight'].sort(),
      );
    }
  });

  it('текст вместо числа — ошибка «Введите число», а не «Заполните поле»', () => {
    const calculation = evaluateWallpaperForm({
      ...filled,
      roomLength: 'четыре',
      rollPrice: '1e3',
    });
    expect(calculation).toEqual({
      ok: false,
      errors: { roomLength: 'Введите число.', rollPrice: 'Введите число.' },
    });
  });

  it('ошибка ввода в необязательном поле блокирует расчёт', () => {
    const calculation = evaluateWallpaperForm({ ...filled, patternRepeat: '64 см' });
    expect(calculation).toEqual({ ok: false, errors: { patternRepeat: 'Введите число.' } });
  });

  it('некорректный размер окна не важен, пока окон нет', () => {
    const calculation = evaluateWallpaperForm({ ...filled, windowWidth: 'abc', windowCount: '0' });
    expect(calculation.ok).toBe(true);
  });

  it('некорректный размер окна важен, если окна есть', () => {
    const calculation = evaluateWallpaperForm({
      ...filled,
      windowCount: '1',
      windowWidth: 'abc',
      windowHeight: '1,4',
    });
    expect(calculation).toEqual({ ok: false, errors: { windowWidth: 'Введите число.' } });
  });
});

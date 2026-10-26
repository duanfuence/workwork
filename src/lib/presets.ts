/**
 * Связь «тип материала ↔ значение поля» для ориентиров расхода. Чистые функции без DOM: их использует
 * общий механизм форм (src/client/calculator-form.ts), данные — src/data/material-presets.ts.
 *
 * Поле расхода — главный источник значения: выбор типа только подставляет число, а ручная правка,
 * после которой число отличается от ориентира, переключает выбор на «Своё значение».
 */
import { parseDecimal } from './number';
import { fmt } from './validation';

/** Значение выбора «Своё значение (с упаковки)». */
export const customChoice = '';

export interface PresetChoice {
  id: string;
  /** Значение поля в виде, который принимает разбор поля: «1,3». */
  fieldText: string;
}

/** Число ориентира — текстом для поля: десятичная запятая, без лишних нулей. */
export const presetFieldText = (value: number): string => fmt(value);

function sameNumber(a: string, b: string): boolean {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  return (
    left.kind === 'number' && right.kind === 'number' && Math.abs(left.value - right.value) < 1e-9
  );
}

/** Что подставить в поле при выборе типа; `null` — «Своё значение»: поле не меняется. */
export function fieldTextForChoice(choices: readonly PresetChoice[], id: string): string | null {
  return choices.find((choice) => choice.id === id)?.fieldText ?? null;
}

/**
 * Выбор после правки поля: тот же тип, если число в поле совпадает с его ориентиром («1.30» = «1,3»),
 * иначе «Своё значение».
 */
export function choiceAfterEdit(
  choices: readonly PresetChoice[],
  selectedId: string,
  fieldText: string,
): string {
  const selected = choices.find((choice) => choice.id === selectedId);
  return selected && sameNumber(selected.fieldText, fieldText) ? selected.id : customChoice;
}

/** Ориентир, по которому посчитан результат, или `null`, если в поле своё значение. */
export function activeChoice(
  choices: readonly PresetChoice[],
  selectedId: string,
  fieldText: string,
): PresetChoice | null {
  const id = choiceAfterEdit(choices, selectedId, fieldText);
  return choices.find((choice) => choice.id === id) ?? null;
}

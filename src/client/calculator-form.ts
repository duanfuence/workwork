/**
 * Поведение формы калькулятора в браузере: чтение полей, ошибки у полей и сводкой,
 * фокус на первом ошибочном поле, состояния блока результата, пересчёт и сброс.
 *
 * Модуль не знает ни формул, ни состава результата: расчёт (`evaluate`) и вывод чисел
 * (`render`) передаёт страница калькулятора. Контракт разметки:
 * - поля `<input name="…">` или `<select name="…">` внутри формы, у каждого `data-label`
 *   и `[data-error-for="…"]` (это дают компоненты NumberField и SelectField);
 * - блок результата из компонента CalculatorResult: `[data-state-panel]`, `[data-error-summary]`,
 *   заголовок `[data-result-heading]`, места вывода `[data-out]`, списки `[data-out-list]`
 *   и строки `[data-row]`;
 * - необязательно: выбор ориентира `select[data-preset-for="<id поля>"]` (компонент PresetSelect) —
 *   подставляет значение варианта (`data-field-value`) в поле; строка-пометка `[data-preset-note="<name поля>"]`
 *   в результате видна, пока расчёт идёт по ориентиру (текст — `data-note` варианта).
 */
import type { Calculation, FieldErrors } from '../lib/form';
import {
  activeChoice,
  choiceAfterEdit,
  fieldTextForChoice,
  type PresetChoice,
} from '../lib/presets';

type State = 'empty' | 'invalid' | 'ready';

/** Вывод значений в блок результата. */
export interface ResultView {
  /** Записать текст в `[data-out="name"]`. */
  text(name: string, value: string): void;
  /** Показать или скрыть все `[data-row="name"]`. */
  show(row: string, visible: boolean): void;
  /** Заменить пункты списка `[data-out-list="name"]`. */
  list(name: string, items: readonly string[]): void;
}

type Control = HTMLInputElement | HTMLSelectElement;

export interface CalculatorFormOptions<F extends string, R> {
  form: HTMLFormElement;
  result: HTMLElement;
  /** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
  fields: readonly F[];
  evaluate(values: Record<F, string>): Calculation<F, R>;
  render(result: R, view: ResultView): void;
}

export function initCalculatorForm<F extends string, R>({
  form,
  result,
  fields,
  evaluate,
  render,
}: CalculatorFormOptions<F, R>): void {
  const heading = result.querySelector<HTMLElement>('[data-result-heading]');
  const summary = result.querySelector<HTMLUListElement>('[data-error-summary]');
  const inputs = new Map<F, Control>();
  for (const field of fields) {
    const input = form.querySelector<Control>(`input[name="${field}"], select[name="${field}"]`);
    if (input) inputs.set(field, input);
  }
  // До первой отправки ошибки не показываются; после — пересчёт при каждом вводе.
  let live = false;

  // Выбор ориентира: подставляет значение в поле; правка поля переключает выбор на «Своё значение».
  const presets = [...form.querySelectorAll<HTMLSelectElement>('select[data-preset-for]')].flatMap(
    (select) => {
      const input = document.getElementById(select.dataset['presetFor'] ?? '');
      if (!(input instanceof HTMLInputElement)) return [];
      const choices: PresetChoice[] = [...select.options]
        .filter((option) => option.dataset['fieldValue'] !== undefined)
        .map((option) => ({ id: option.value, fieldText: option.dataset['fieldValue'] ?? '' }));
      const note = result.querySelector<HTMLElement>(`[data-preset-note="${input.name}"]`);
      return [{ select, input, choices, note }];
    },
  );

  const showPresetNotes = () => {
    for (const { select, input, choices, note } of presets) {
      if (!note) continue;
      const active = activeChoice(choices, select.value, input.value);
      note.textContent = active ? (select.selectedOptions[0]?.dataset['note'] ?? '') : '';
      note.hidden = !active;
    }
  };

  const view: ResultView = {
    text(name, value) {
      const element = result.querySelector<HTMLElement>(`[data-out="${name}"]`);
      if (element) element.textContent = value;
    },
    show(row, visible) {
      for (const element of result.querySelectorAll<HTMLElement>(`[data-row="${row}"]`)) {
        element.hidden = !visible;
      }
    },
    list(name, items) {
      const element = result.querySelector<HTMLElement>(`[data-out-list="${name}"]`);
      element?.replaceChildren(
        ...items.map((text) => {
          const item = document.createElement('li');
          item.textContent = text;
          return item;
        }),
      );
    },
  };

  // Явная прокрутка: при обычном focus() поле может оказаться под липкой шапкой.
  const focusField = (input: Control) => {
    input.focus({ preventScroll: true });
    (input.closest('.field') ?? input).scrollIntoView({ block: 'center' });
  };

  const setState = (state: State) => {
    result.dataset['state'] = state;
    for (const panel of result.querySelectorAll<HTMLElement>('[data-state-panel]')) {
      panel.hidden = panel.dataset['statePanel'] !== state;
    }
  };

  const readValues = (): Record<F, string> => {
    const values = {} as Record<F, string>;
    for (const field of fields) values[field] = inputs.get(field)?.value ?? '';
    return values;
  };

  const showErrors = (errors: FieldErrors<F>) => {
    for (const field of fields) {
      const input = inputs.get(field);
      const message = errors[field];
      const errorElement = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
      if (errorElement) {
        errorElement.textContent = message ?? '';
        errorElement.hidden = !message;
      }
    }
    summary?.replaceChildren(
      ...fields
        .filter((field) => errors[field])
        .map((field) => {
          const input = inputs.get(field);
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = `#${input?.id ?? ''}`;
          link.textContent = `${input?.dataset['label'] ?? field}: ${errors[field] ?? ''}`;
          link.addEventListener('click', (event) => {
            event.preventDefault();
            if (input) focusField(input);
          });
          item.append(link);
          return item;
        }),
    );
  };

  const update = (moveFocus: boolean) => {
    const calculation = evaluate(readValues());
    if (calculation.ok) {
      showErrors({});
      render(calculation.result, view);
      showPresetNotes();
      setState('ready');
      if (moveFocus && heading) {
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: 'start' });
      }
      return;
    }
    // При ошибках результат скрывается — устаревшие цифры не показываются.
    showErrors(calculation.errors);
    setState('invalid');
    if (moveFocus) {
      const firstInvalid = fields.find((field) => calculation.errors[field]);
      const input = firstInvalid ? inputs.get(firstInvalid) : undefined;
      if (input) focusField(input);
    }
  };

  // Раньше пересчёта: при живом пересчёте уже видно подставленное значение. Фокус не переносится.
  form.addEventListener('input', (event) => {
    for (const { select, input, choices } of presets) {
      if (event.target === select) {
        const text = fieldTextForChoice(choices, select.value);
        if (text !== null) input.value = text;
      } else if (event.target === input) {
        select.value = choiceAfterEdit(choices, select.value, input.value);
      }
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    live = true;
    update(true);
  });

  form.addEventListener('input', () => {
    if (live) update(false);
  });

  form.addEventListener('reset', () => {
    live = false;
    // Значения полей сбрасываются после события reset.
    requestAnimationFrame(() => {
      showErrors({});
      showPresetNotes();
      setState('empty');
    });
  });
}

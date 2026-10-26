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
 *   в результате видна, пока расчёт идёт по ориентиру (текст — `data-note` варианта);
 * - необязательно: поля одного режима `[data-show-when="<name>=<value>"]` (NumberField, SelectField с `showWhen`) —
 *   видны, пока в выборе `<name>` значение `<value>`; скрытые поля `evaluate` страницы не разбирает;
 * - главный итог `.calc-result__main` и короткий итог `view.summary(…)` из `render` — для панели итога
 *   `[data-result-bar]` (на экране уже 960 px, когда итог не виден) и для объявления диктору
 *   `[data-result-announce]` (по «Рассчитать» и после паузы ввода, D-024). Оба элемента даёт CalculatorResult.
 */
import type { Calculation, FieldErrors } from '../lib/form';
import {
  activeChoice,
  choiceAfterEdit,
  fieldTextForChoice,
  type PresetChoice,
} from '../lib/presets';
import {
  announceDelayMs,
  keyboardLikelyOpen,
  resultAnnouncement,
  resultBarView,
  resultInView,
  resultViewInset,
  type ResultState,
} from '../lib/result-bar';

type State = ResultState;

/** Вывод значений в блок результата. */
export interface ResultView {
  /** Записать текст в `[data-out="name"]`. */
  text(name: string, value: string): void;
  /** Показать или скрыть все `[data-row="name"]`. */
  show(row: string, visible: boolean): void;
  /** Заменить пункты списка `[data-out-list="name"]`. */
  list(name: string, items: readonly string[]): void;
  /** Короткий итог одной строкой — для панели итога и диктора: «11,9 л краски · 3 банки». */
  summary(text: string): void;
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
  // Поля одного режима: видны, пока в выборе нужное значение («Считать: помещение / отдельные стены»).
  const conditional = [...form.querySelectorAll<HTMLElement>('[data-show-when]')];
  const applyVisibility = () => {
    for (const element of conditional) {
      const [name = '', value = ''] = (element.dataset['showWhen'] ?? '').split('=');
      const control = form.elements.namedItem(name);
      element.hidden = !(control instanceof HTMLSelectElement && control.value === value);
    }
  };
  applyVisibility();

  // До первой отправки ошибки не показываются; после — пересчёт при каждом вводе.
  let live = false;
  let state: State = 'empty';
  // Был успешный расчёт после последнего сброса: до него панели итога нет.
  let calculated = false;
  let summaryText = '';

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
    summary(text) {
      summaryText = text;
    },
  };

  // Объявление диктору: отдельная скрытая область вместо role="status" на числе — иначе диктор
  // зачитывал бы итог на каждое нажатие клавиши при живом пересчёте.
  const announcer = result.querySelector<HTMLElement>('[data-result-announce]');
  let announced = '';
  let announceTimer = 0;
  const announce = (text: string) => {
    window.clearTimeout(announceTimer);
    if (!announcer) return;
    announced = text;
    // Очистка и запись через паузу: тот же текст после повторного «Рассчитать» объявляется снова.
    announcer.textContent = '';
    if (text !== '') announceTimer = window.setTimeout(() => (announcer.textContent = text), 50);
  };
  const announceAfterPause = () => {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      const text = resultAnnouncement(state, summaryText);
      if (text !== announced) announce(text);
    }, announceDelayMs);
  };

  // Панель итога внизу экрана на телефоне: видна, когда главный итог (или сообщение об ошибках) вне экрана.
  const bar = result.parentElement?.querySelector<HTMLButtonElement>(':scope > [data-result-bar]');
  const barText = bar?.querySelector<HTMLElement>('[data-result-bar-text]');
  const mainResult = result.querySelector<HTMLElement>('.calc-result__main');
  const invalidMessage = result.querySelector<HTMLElement>('.calc-result__invalid');
  const wide = window.matchMedia('(min-width: 60rem)');
  // Наибольшая высота окна при текущей ширине: старые Android при клавиатуре уменьшают само окно.
  let fullWidth = window.innerWidth;
  let fullHeight = window.innerHeight;

  const keyboardOpen = () => {
    if (window.innerWidth !== fullWidth) {
      fullWidth = window.innerWidth;
      fullHeight = window.innerHeight;
    } else {
      fullHeight = Math.max(fullHeight, window.innerHeight);
    }
    const viewport = window.visualViewport;
    const visibleHeight = viewport ? viewport.height * viewport.scale : window.innerHeight;
    const active = document.activeElement;
    const textField =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement &&
        ['text', 'number', 'search', 'tel', 'email', 'url', 'password'].includes(active.type));
    return keyboardLikelyOpen(textField, visibleHeight, fullHeight);
  };

  // Фокус перешёл (Tab, «Далее»): если элемент формы оказался под панелью — прокрутить его выше панели.
  // Браузер при фокусе прокручивает только к краю окна и панель не учитывает.
  let focusMoved = false;
  const revealFocused = (barVisible: boolean) => {
    focusMoved = false;
    const active = document.activeElement;
    if (!barVisible || !bar || !(active instanceof HTMLElement) || !form.contains(active)) return;
    const overlap = active.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
    if (overlap > 0) window.scrollBy({ top: overlap + 16, behavior: 'instant' });
  };

  const refreshBar = () => {
    if (!bar || !barText) return;
    const target = state === 'invalid' ? invalidMessage : mainResult;
    const rect = target?.getBoundingClientRect();
    const barView = resultBarView({
      calculated,
      state,
      narrow: !wide.matches,
      resultInView: rect ? resultInView(rect.top, rect.bottom, window.innerHeight) : true,
      keyboardOpen: keyboardOpen(),
      summary: summaryText,
    });
    if (barView.visible) {
      // Части итога «11,9 л краски · 5 банок» не разрываются: на 320 px перенос только между ними.
      const parts = barView.text.split(' · ');
      barText.replaceChildren(
        ...parts.flatMap((part, index) => {
          const span = document.createElement('span');
          span.className = 'result-bar__part';
          span.textContent = index < parts.length - 1 ? `${part} ·` : part;
          return index === 0 ? [span] : [' ', span];
        }),
      );
      bar.dataset['tone'] = barView.tone;
    }
    bar.hidden = !barView.visible;
    // Отступ страницы снизу и scroll-padding-bottom, пока панель на экране (calculator.css); высота —
    // фактическая: на 320 px итог может занять две строки.
    const root = document.documentElement;
    root.toggleAttribute('data-result-bar-shown', barView.visible);
    if (barView.visible) root.style.setProperty('--result-bar-space', `${bar.offsetHeight}px`);
    if (focusMoved) revealFocused(barView.visible);
  };

  let barFrame = 0;
  const scheduleBar = () => {
    window.cancelAnimationFrame(barFrame);
    barFrame = window.requestAnimationFrame(refreshBar);
  };

  if (bar && barText) {
    // Наблюдатель только будит пересчёт; видимость считает resultInView по тем же полям области.
    const observer = new IntersectionObserver(scheduleBar, {
      rootMargin: `-${resultViewInset.top}px 0px -${resultViewInset.bottom}px 0px`,
      threshold: [0, 0.5, 1],
    });
    for (const target of [mainResult, invalidMessage]) if (target) observer.observe(target);
    wide.addEventListener('change', scheduleBar);
    window.addEventListener('resize', scheduleBar);
    window.visualViewport?.addEventListener('resize', scheduleBar);
    document.addEventListener('focusin', () => {
      focusMoved = true;
      scheduleBar();
    });
    document.addEventListener('focusout', scheduleBar);

    // Вся панель — кнопка «К результату»: прокрутка к результату и фокус на его заголовке.
    bar.addEventListener('click', () => {
      if (!heading) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  // Явная прокрутка: при обычном focus() поле может оказаться под липкой шапкой.
  const focusField = (input: Control) => {
    input.focus({ preventScroll: true });
    (input.closest('.field') ?? input).scrollIntoView({ block: 'center' });
  };

  const setState = (next: State) => {
    state = next;
    result.dataset['state'] = next;
    for (const panel of result.querySelectorAll<HTMLElement>('[data-state-panel]')) {
      panel.hidden = panel.dataset['statePanel'] !== next;
    }
    scheduleBar();
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
      summaryText = '';
      render(calculation.result, view);
      // Страница без view.summary — в панели текст главного итога.
      if (summaryText === '')
        summaryText = (mainResult?.textContent ?? '').replace(/\s+/g, ' ').trim();
      showPresetNotes();
      calculated = true;
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
    if (event.target instanceof HTMLSelectElement) applyVisibility();
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
    announce(resultAnnouncement(state, summaryText));
  });

  form.addEventListener('input', () => {
    if (!live) return;
    update(false);
    announceAfterPause();
  });

  form.addEventListener('reset', () => {
    live = false;
    calculated = false;
    announce('');
    // Значения полей сбрасываются после события reset.
    requestAnimationFrame(() => {
      applyVisibility();
      showErrors({});
      showPresetNotes();
      setState('empty');
    });
  });
}

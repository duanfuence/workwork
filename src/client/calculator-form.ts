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
 * - необязательно: поля помещения `roomLength`, `roomWidth`, `wallHeight` — размеры комнаты сохраняются в браузере
 *   после успешного расчёта и подставляются в пустые поля другого калькулятора (D-026);
 * - кнопки «Ссылка на расчёт» и «Скопировать итог» `[data-share]` (CalculatorResult) и `view.report(…)` из `render` —
 *   ключевые параметры и что купить; ссылка `?v=1&…` при открытии заполняет форму и сразу считает (D-027);
 * - главный итог `.calc-result__main` и короткий итог `view.summary(…)` из `render` — для панели итога
 *   `[data-result-bar]` (на экране уже 960 px, когда итог не виден) и для объявления диктору
 *   `[data-result-announce]` (по «Рассчитать» и после паузы ввода, D-024). Оба элемента даёт CalculatorResult.
 */
import { typograph } from '../lib/format';
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
import {
  mergeRoom,
  parseStoredRoom,
  roomFields,
  roomFill,
  roomNoticeSizes,
  roomStorageKey,
  roomToSave,
  serializeRoom,
  type RoomControls,
  type RoomField,
} from '../lib/room-memory';
import {
  buildShareQuery,
  parseShareQuery,
  shareText,
  startValues,
  type ShareControl,
  type ShareValue,
} from '../lib/share-link';
import { parseTypicalRange, typicalWarning } from '../lib/typical-value';

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
  /** Для «Скопировать итог»: ключевые параметры строками и что купить («5 банок по 2,7 л (13,5 л)»). */
  report(params: readonly string[], purchase: string): void;
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
  let reportParams: readonly string[] = [];
  let reportPurchase = '';

  // Выбор ориентира: подставляет значение в поле; правка поля переключает выбор на «Своё значение».
  const presets = [...form.querySelectorAll<HTMLSelectElement>('select[data-preset-for]')].flatMap(
    (select) => {
      const input = document.getElementById(select.dataset['presetFor'] ?? '');
      if (!(input instanceof HTMLInputElement)) return [];
      const choices: PresetChoice[] = [...select.options]
        .filter((option) => option.dataset['fieldValue'] !== undefined)
        .map((option) => ({ id: option.value, fieldText: option.dataset['fieldValue'] ?? '' }));
      const note = result.querySelector<HTMLElement>(`[data-preset-note="${input.name}"]`);
      // Предупреждение о нетипичном значении: у поля (в его описании) и в результате — после пометки ориентира.
      const typical = parseTypicalRange(select.dataset['typical']);
      const fieldWarning = form.querySelector<HTMLElement>(`[data-warning-for="${input.name}"]`);
      let resultWarning: HTMLElement | null = null;
      if (typical && note) {
        resultWarning = document.createElement('p');
        resultWarning.className = 'calc-result__warning';
        resultWarning.hidden = true;
        note.after(resultWarning);
      }
      return [{ select, input, choices, note, typical, fieldWarning, resultWarning }];
    },
  );

  // Текст предупреждений для диктора: дописывается к объявлению итога (по «Рассчитать» и после паузы ввода).
  // У поля с ошибкой предупреждения нет — достаточно текста ошибки.
  let warningsText = '';
  const showWarnings = (visible: boolean, invalid: ReadonlySet<string> = new Set()) => {
    const texts: string[] = [];
    for (const { input, typical, fieldWarning, resultWarning } of presets) {
      const text =
        visible && typical && !invalid.has(input.name)
          ? typicalWarning(typical, input.value)
          : null;
      if (text) texts.push(typograph(text));
      for (const element of [fieldWarning, resultWarning]) {
        if (!element) continue;
        element.textContent = text ? typograph(text) : '';
        element.hidden = !text;
      }
    }
    warningsText = texts.join(' ');
  };

  const showPresetNotes = () => {
    for (const { select, input, choices, note } of presets) {
      if (!note) continue;
      const active = activeChoice(choices, select.value, input.value);
      note.textContent = active ? typograph(select.selectedOptions[0]?.dataset['note'] ?? '') : '';
      note.hidden = !active;
    }
  };

  // Размеры комнаты между калькуляторами (D-026). Хранилище бывает недоступно (приватный режим, запрет
  // сайтам хранить данные) — тогда калькулятор работает как без запоминания, без ошибок.
  const storage = {
    read(): string | null {
      try {
        return window.localStorage.getItem(roomStorageKey);
      } catch {
        return null;
      }
    },
    write(value: string) {
      try {
        window.localStorage.setItem(roomStorageKey, value);
      } catch {
        // без запоминания
      }
    },
    remove() {
      try {
        window.localStorage.removeItem(roomStorageKey);
      } catch {
        // без запоминания
      }
    },
  };
  const roomInputs = roomFields.flatMap((field) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${field}"]`);
    return input ? [[field, input] as const] : [];
  });
  const roomControls = (): RoomControls => {
    const controls: RoomControls = {};
    for (const [field, input] of roomInputs) {
      controls[field] = { value: input.value, active: input.closest('[hidden]') === null };
    }
    return controls;
  };
  // «Дальше для этой комнаты»: пометка «размеры подставятся» — только когда размеры правда сохранены.
  const showRoomNextHint = () => {
    const stored = parseStoredRoom(storage.read());
    const saved = stored?.roomLength !== undefined && stored.roomWidth !== undefined;
    for (const hint of document.querySelectorAll<HTMLElement>('[data-room-next-hint]')) {
      hint.hidden = !saved;
    }
  };
  const saveRoom = () => {
    const sizes = roomToSave(roomControls());
    if (sizes) storage.write(serializeRoom(mergeRoom(parseStoredRoom(storage.read()), sizes)));
    showRoomNextHint();
  };
  // Строка над формой «Размеры комнаты подставлены… · Очистить» и что именно подставлено.
  let roomNotice: HTMLElement | null = null;
  let roomFilled: Partial<Record<RoomField, string>> = {};
  const hideRoomNotice = () => {
    roomNotice?.remove();
    roomNotice = null;
    roomFilled = {};
  };

  // Крупное моноширинное число «К покупке»: запятая занимает целую клетку и читается как «145 , 2» —
  // разделитель — в отдельном span, поджатом отрицательными отступами (calculator.css). Текст числа не меняется.
  const tightenDecimals = () => {
    for (const number of result.querySelectorAll<HTMLElement>('.calc-result__number')) {
      const text = number.textContent;
      const comma = text.indexOf(',');
      if (comma < 0) continue;
      const separator = document.createElement('span');
      separator.className = 'calc-result__decimal';
      separator.textContent = ',';
      number.replaceChildren(text.slice(0, comma), separator, text.slice(comma + 1));
    }
  };

  const view: ResultView = {
    text(name, value) {
      const element = result.querySelector<HTMLElement>(`[data-out="${name}"]`);
      // Русская типографика: «10 %», «2,7 л», «— 101 л» не разрываются переносом строки.
      if (element) element.textContent = typograph(value);
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
          item.textContent = typograph(text);
          return item;
        }),
      );
    },
    summary(text) {
      summaryText = typograph(text);
    },
    report(params, purchase) {
      reportParams = params.map(typograph);
      reportPurchase = typograph(purchase);
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
  const withWarnings = (text: string) =>
    text !== '' && warningsText !== '' ? `${text}. ${warningsText}` : text;
  const announceAfterPause = () => {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      const text = withWarnings(resultAnnouncement(state, summaryText));
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
        errorElement.textContent = typograph(message ?? '');
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
          link.textContent = typograph(
            `${input?.dataset['label'] ?? field}: ${errors[field] ?? ''}`,
          );
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
    showWarnings(true, new Set(calculation.ok ? [] : Object.keys(calculation.errors)));
    if (calculation.ok) {
      showErrors({});
      summaryText = '';
      reportParams = [];
      reportPurchase = '';
      render(calculation.result, view);
      tightenDecimals();
      // Страница без view.summary — в панели текст главного итога.
      if (summaryText === '')
        summaryText = (mainResult?.textContent ?? '').replace(/\s+/g, ' ').trim();
      showPresetNotes();
      saveRoom();
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
    announce(withWarnings(resultAnnouncement(state, summaryText)));
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
    hideRoomNotice();
    hideShareFeedback();
    showWarnings(false);
    requestAnimationFrame(() => {
      applyVisibility();
      showErrors({});
      showPresetNotes();
      setState('empty');
    });
  });

  // Сохранённые размеры — только в пустые поля (roomFill); расчёт сам не запускается.
  const restoreRoom = (fill: Partial<Record<RoomField, string>>) => {
    roomFilled = fill;
    const sizes = roomNoticeSizes(roomFilled);
    if (sizes === '') return;
    for (const [field, input] of roomInputs) {
      const text = roomFilled[field];
      if (text !== undefined) input.value = text;
    }
    const notice = document.createElement('p');
    notice.className = 'calc-memory';
    notice.dataset['roomNotice'] = '';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'calc-memory__clear';
    clear.textContent = 'Очистить';
    clear.addEventListener('click', () => {
      storage.remove();
      // Очищаются только поля, которые с подстановки не правили.
      let first: HTMLInputElement | null = null;
      for (const [field, input] of roomInputs) {
        if (roomFilled[field] !== undefined && input.value === roomFilled[field]) {
          input.value = '';
          first ??= input;
        }
      }
      hideRoomNotice();
      showRoomNextHint();
      (first ?? roomInputs[0]?.[1])?.focus();
      if (live) update(false);
    });
    const text = document.createElement('span');
    text.textContent = typograph(`Размеры комнаты подставлены из прошлого расчёта: ${sizes} ·`);
    notice.append(text, ' ', clear);
    const title = form.querySelector('h2');
    if (title) title.after(notice);
    else form.prepend(notice);
    roomNotice = notice;
  };

  // Ссылка на расчёт и копирование итога (D-027).
  const named: Control[] = [...inputs.values(), ...presets.map(({ select }) => select)];
  const shareControls: ShareControl[] = named.map((control) =>
    control instanceof HTMLSelectElement
      ? {
          name: control.name,
          kind: 'choice',
          options: [...control.options].map((option) => option.value),
        }
      : { name: control.name, kind: 'number' },
  );
  const shareUrl = () => {
    const values: ShareValue[] = named
      .filter((control) => control.closest('[hidden]') === null)
      .map((control) => ({
        name: control.name,
        kind: control instanceof HTMLSelectElement ? 'choice' : 'number',
        value: control.value,
      }));
    return `${window.location.origin}${window.location.pathname}?${buildShareQuery(values)}`;
  };
  const pageTitle = () => document.querySelector('h1')?.textContent?.trim() ?? document.title;

  const share = result.querySelector<HTMLElement>('[data-share]');
  const shareStatus = share?.querySelector<HTMLElement>('[data-share-status]');
  const manual = share?.querySelector<HTMLElement>('[data-share-manual]');
  const manualText = share?.querySelector<HTMLTextAreaElement>('[data-share-text]');
  /** Сколько держится «Скопировано ✓» на кнопке. */
  const copiedMs = 2000;
  let statusTimer = 0;
  let copiedTimer = 0;
  function hideShareFeedback() {
    window.clearTimeout(statusTimer);
    window.clearTimeout(copiedTimer);
    if (shareStatus) shareStatus.textContent = '';
    for (const button of share?.querySelectorAll('[data-copied]') ?? [])
      button.removeAttribute('data-copied');
    if (manual) manual.hidden = true;
  }
  // Подтверждение на самой кнопке: «Скопировано ✓» на 2 с (CSS по data-copied, размер кнопки не меняется).
  // Диктору «Скопировано» объявляется один раз: текст записывается после очистки и затем убирается молча.
  const confirmCopied = (button: HTMLElement) => {
    hideShareFeedback();
    button.setAttribute('data-copied', '');
    copiedTimer = window.setTimeout(() => button.removeAttribute('data-copied'), copiedMs);
    statusTimer = window.setTimeout(() => {
      if (shareStatus) shareStatus.textContent = 'Скопировано';
      statusTimer = window.setTimeout(() => {
        if (shareStatus) shareStatus.textContent = '';
      }, copiedMs);
    }, 50);
  };
  // Буфер обмена недоступен (нет разрешения, не HTTPS) — текст в поле, выделен для копирования вручную.
  const showManual = (text: string) => {
    hideShareFeedback();
    if (!manual || !manualText) return;
    manualText.value = text;
    manual.hidden = false;
    manualText.focus();
    manualText.select();
  };
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
  const copyOrShow = async (text: string, button: HTMLElement) => {
    if (await copyText(text)) confirmCopied(button);
    else showManual(text);
  };

  if (share) {
    share.hidden = false;
    share.querySelector<HTMLElement>('[data-share-link]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLElement;
      void (async () => {
        const url = shareUrl();
        // На телефоне — системное меню «Поделиться»; отмена — не ошибка.
        if ('share' in navigator && window.matchMedia('(pointer: coarse)').matches) {
          try {
            await navigator.share({ title: pageTitle(), url });
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
          }
        }
        await copyOrShow(url, button);
      })();
    });
    share.querySelector<HTMLElement>('[data-share-copy]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLElement;
      const text = shareText({
        title: pageTitle(),
        params: reportParams,
        purchase: reportPurchase || summaryText,
        url: shareUrl(),
      });
      void copyOrShow(text, button);
    });
  }

  // Открытие ссылки на расчёт: форма заполняется и сразу считается; значения ссылки важнее сохранённых
  // размеров комнаты. Сначала выборы (режим, тип материала) — от режима зависит, какие поля видны.
  const applyLink = (values: Record<string, string>) => {
    for (const control of named) {
      const value = values[control.name];
      if (control instanceof HTMLSelectElement && value !== undefined) control.value = value;
    }
    applyVisibility();
    for (const control of named) {
      const value = values[control.name];
      if (control instanceof HTMLInputElement && value !== undefined) control.value = value;
    }
    for (const { select, input, choices } of presets) {
      select.value = choiceAfterEdit(choices, select.value, input.value);
    }
    live = true;
    update(false);
  };

  const start = startValues(
    parseShareQuery(window.location.search, shareControls),
    roomFill(parseStoredRoom(storage.read()), roomControls()),
  );
  showRoomNextHint();
  if (start.source === 'link') applyLink(start.values);
  else if (start.source === 'memory') restoreRoom(start.values);
}

import { parseNumberFields, withParseErrors } from '../form';
import { calculatePlaster, type PlasterCalculation, type PlasterField } from './plaster';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const plasterFields = [
  'mode',
  'roomLength',
  'roomWidth',
  'wallLength',
  'wallHeight',
  'wallCount',
  'openingsArea',
  'thickness',
  'consumption',
  'bagMass',
  'reserve',
  'bagPrice',
] as const satisfies readonly PlasterField[];

/** Числовые поля каждого режима: поля другого режима скрыты и не разбираются. */
const commonNumberFields = [
  'wallHeight',
  'openingsArea',
  'thickness',
  'consumption',
  'bagMass',
  'bagPrice',
  'reserve',
] as const;
const roomNumberFields = ['roomLength', 'roomWidth', ...commonNumberFields] as const;
const wallsNumberFields = ['wallLength', 'wallCount', ...commonNumberFields] as const;

type NumberField = (typeof roomNumberFields)[number] | (typeof wallsNumberFields)[number];
type ChoiceField = 'mode' | 'roomLength' | 'roomWidth';

/** Значения полей формы. Без выбора режима и полей помещения — режим «стены» (модель 1). */
export type PlasterFormValues = Record<Exclude<PlasterField, ChoiceField>, string> &
  Partial<Record<ChoiceField, string>>;

/** Разбирает текст полей выбранного режима и выполняет расчёт. */
export function evaluatePlasterForm(values: PlasterFormValues): PlasterCalculation {
  const room = values.mode === 'room';
  const all = { roomLength: '', roomWidth: '', ...values };
  const parsed = parseNumberFields<NumberField>(room ? roomNumberFields : wallsNumberFields, all);
  // Поля другого режима в разбор не попали — для расчёта они пустые.
  const number: Partial<Record<NumberField, number | null>> = parsed.values;
  const calculation = calculatePlaster({
    mode: values.mode ?? null,
    roomLength: number.roomLength ?? null,
    roomWidth: number.roomWidth ?? null,
    wallLength: number.wallLength ?? null,
    wallHeight: number.wallHeight ?? null,
    wallCount: number.wallCount ?? null,
    openingsArea: number.openingsArea ?? null,
    thickness: number.thickness ?? null,
    consumption: number.consumption ?? null,
    reserve: number.reserve ?? null,
    bagMass: number.bagMass ?? null,
    bagPrice: number.bagPrice ?? null,
  });
  return withParseErrors(calculation, parsed.errors);
}

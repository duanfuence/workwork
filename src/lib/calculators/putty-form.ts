import { parseNumberFields, withParseErrors } from '../form';
import { calculatePutty, type PuttyCalculation, type PuttyField } from './putty';

/** Поля в порядке формы — в этом порядке ищется первое поле с ошибкой. */
export const puttyFields = [
  'mode',
  'roomLength',
  'roomWidth',
  'wallLength',
  'wallHeight',
  'wallCount',
  'openingsArea',
  'ceiling',
  'layers',
  'consumption',
  'packMass',
  'reserve',
  'packPrice',
] as const satisfies readonly PuttyField[];

/** Числовые поля каждого режима: поля другого режима скрыты и не разбираются. */
const commonNumberFields = [
  'wallHeight',
  'openingsArea',
  'layers',
  'consumption',
  'packMass',
  'packPrice',
  'reserve',
] as const;
const roomNumberFields = ['roomLength', 'roomWidth', ...commonNumberFields] as const;
const wallsNumberFields = ['wallLength', 'wallCount', ...commonNumberFields] as const;

type NumberField = (typeof roomNumberFields)[number] | (typeof wallsNumberFields)[number];
type ChoiceField = 'mode' | 'roomLength' | 'roomWidth' | 'ceiling';

/** Значения полей формы. Без выбора режима и полей помещения — режим «стены» (модель 1). */
export type PuttyFormValues = Record<Exclude<PuttyField, ChoiceField>, string> &
  Partial<Record<ChoiceField, string>>;

/** Разбирает текст полей выбранного режима и выполняет расчёт. */
export function evaluatePuttyForm(values: PuttyFormValues): PuttyCalculation {
  const room = values.mode === 'room';
  const all = { roomLength: '', roomWidth: '', ...values };
  const parsed = parseNumberFields<NumberField>(room ? roomNumberFields : wallsNumberFields, all);
  // Поля другого режима в разбор не попали — для расчёта они пустые.
  const number: Partial<Record<NumberField, number | null>> = parsed.values;
  const calculation = calculatePutty({
    mode: values.mode ?? null,
    roomLength: number.roomLength ?? null,
    roomWidth: number.roomWidth ?? null,
    wallLength: number.wallLength ?? null,
    wallHeight: number.wallHeight ?? null,
    wallCount: number.wallCount ?? null,
    openingsArea: number.openingsArea ?? null,
    ceiling: room ? (values.ceiling ?? null) : null,
    layers: number.layers ?? null,
    consumption: number.consumption ?? null,
    reserve: number.reserve ?? null,
    packMass: number.packMass ?? null,
    packPrice: number.packPrice ?? null,
  });
  return withParseErrors(calculation, parsed.errors);
}

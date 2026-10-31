import { describe, expect, it } from 'vitest';
import { paintLimits } from '../lib/calculators/paint';
import { plasterLimits } from '../lib/calculators/plaster';
import { puttyLimits } from '../lib/calculators/putty';
import { parseDecimal } from '../lib/number';
import { presetFieldText, presetValueByRule } from '../lib/presets';
import { hasPrecision } from '../lib/validation';
import {
  materialPresets,
  presetRange,
  presetsFor,
  type PresetCalculator,
} from './material-presets';

const research = Object.values(
  import.meta.glob<string>('../../docs/research/MATERIAL_PRESETS.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0];

/** Предел и точность поля, в которое подставляется ориентир (как проверяет расчёт). */
const fieldRules: Record<PresetCalculator, { min: number; max: number; digits: number }> = {
  paint: { ...paintLimits.coverage, digits: 1 },
  plaster: { ...plasterLimits.consumption, digits: 2 },
  putty: { ...puttyLimits.consumption, digits: 2 },
};

describe('ориентиры расхода', () => {
  it('идентификаторы уникальны, у каждого калькулятора есть ориентиры', () => {
    const ids = materialPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const calculator of ['paint', 'plaster', 'putty'] as const) {
      expect(presetsFor(calculator).length).toBeGreaterThan(0);
    }
  });

  it.each(materialPresets.map((preset) => [preset.id, preset]))(
    '%s: в пределах поля и в формате разбора',
    (_id, preset) => {
      const rule = fieldRules[preset.calculator];
      expect(preset.value).toBeGreaterThanOrEqual(rule.min);
      expect(preset.value).toBeLessThanOrEqual(rule.max);
      expect(hasPrecision(preset.value, rule.digits)).toBe(true);
      expect(parseDecimal(presetFieldText(preset.value))).toEqual({
        kind: 'number',
        value: preset.value,
      });
    },
  );

  it.each(materialPresets.map((preset) => [preset.id, preset]))(
    '%s: значение по правилу D-023 (медиана), не меньше трёх источников',
    (_id, preset) => {
      const kind = preset.calculator === 'paint' ? 'coverage' : 'consumption';
      expect(preset.value).toBe(presetValueByRule(kind, preset.sources));
      const range = presetRange(preset);
      expect(preset.value).toBeGreaterThanOrEqual(range.min);
      expect(preset.value).toBeLessThanOrEqual(range.max);
      for (const source of preset.sources) expect(source.min).toBeLessThanOrEqual(source.max);
      expect(preset.sources.length).toBeGreaterThanOrEqual(3);
      expect(research).toContain(`\n## ${preset.research}\n`);
    },
  );

  it('ожидаемые ориентиры (расчёт — docs/research/MATERIAL_PRESETS.md)', () => {
    expect(Object.fromEntries(materialPresets.map((preset) => [preset.id, preset.value]))).toEqual({
      'paint-interior': 7,
      'plaster-gypsum': 1,
      'plaster-cement': 1.6,
      'putty-gypsum-start': 1,
      'putty-gypsum-finish': 0.9,
      'putty-polymer-paste': 1.7,
    });
  });

  it('у шпаклёвки указана толщина слоя, к которой относится расход', () => {
    for (const preset of presetsFor('putty')) expect(preset.layerMm).toBe(1);
  });
});

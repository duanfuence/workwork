import { describe, expect, it } from 'vitest';
import { paintLimits } from '../lib/calculators/paint';
import { plasterLimits } from '../lib/calculators/plaster';
import { puttyLimits } from '../lib/calculators/putty';
import { parseDecimal } from '../lib/number';
import { presetFieldText } from '../lib/presets';
import { hasPrecision } from '../lib/validation';
import { materialPresets, presetsFor, type PresetCalculator } from './material-presets';

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
    '%s: на стороне большего расхода, не меньше трёх источников',
    (_id, preset) => {
      // Укрывистость: меньше м²/л — больше литров; расход: больше кг/м² — больше мешков.
      const boundary = preset.calculator === 'paint' ? preset.range.min : preset.range.max;
      expect(preset.value).toBe(boundary);
      expect(preset.range.min).toBeLessThanOrEqual(preset.range.max);
      expect(preset.sources.length).toBeGreaterThanOrEqual(3);
      expect(research).toContain(`\n## ${preset.research}\n`);
    },
  );

  it('у шпаклёвки указана толщина слоя, к которой относится расход', () => {
    for (const preset of presetsFor('putty')) expect(preset.layerMm).toBe(1);
  });
});

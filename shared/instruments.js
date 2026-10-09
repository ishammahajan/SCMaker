import { assert, number } from './validation.js';
import { validateGraph } from './synthesis-graph.js';

export const KINDS = ['bass', 'pad', 'pluck', 'kick', 'snare', 'hat', 'custom'];
export const WAVES = ['saw', 'sine', 'pulse', 'triangle'];
export const CONTROLS = {
  brightness: { label: 'Brightness', min: 120, max: 12000, step: 10, unit: 'Hz' },
  drive: { label: 'Drive', min: 0, max: 1, step: 0.01 },
  attack: { label: 'Attack', min: 0.002, max: 2, step: 0.002, unit: 's' },
  release: { label: 'Release', min: 0.02, max: 4, step: 0.02, unit: 's' },
  detune: { label: 'Detune', min: 0, max: 0.03, step: 0.001 },
};

export function preset(kind = 'bass') {
  const base = {
    kind,
    wave: 'saw',
    brightness: 1800,
    drive: 0.15,
    attack: 0.008,
    decay: 0.2,
    sustain: 0.65,
    release: 0.24,
    detune: 0.002,
  };
  const choices = {
    pad: {
      brightness: 2600,
      drive: 0,
      attack: 0.7,
      decay: 0.6,
      sustain: 0.8,
      release: 1.8,
      detune: 0.009,
    },
    pluck: {
      wave: 'triangle',
      brightness: 5000,
      drive: 0,
      attack: 0.002,
      decay: 0.3,
      sustain: 0.12,
      release: 0.3,
    },
    kick: {
      wave: 'sine',
      brightness: 900,
      drive: 0.2,
      attack: 0.002,
      decay: 0.25,
      sustain: 0,
      release: 0.1,
      detune: 0,
    },
    snare: {
      brightness: 6500,
      drive: 0.1,
      attack: 0.002,
      decay: 0.16,
      sustain: 0,
      release: 0.1,
      detune: 0,
    },
    hat: {
      brightness: 10000,
      drive: 0,
      attack: 0.002,
      decay: 0.06,
      sustain: 0,
      release: 0.04,
      detune: 0,
    },
  };
  return {
    ...base,
    ...choices[kind],
    ...(kind === 'custom' ? { graph: { nodes: [{ op: 'sine', args: ['freq'] }] } } : {}),
  };
}

export function validateRecipe(value) {
  assert(value && typeof value === 'object', 'Invalid sound recipe.');
  assert(
    KINDS.includes(value.kind) && WAVES.includes(value.wave),
    'Unknown instrument or oscillator.',
  );
  const recipe = { kind: value.kind, wave: value.wave };
  for (const [key, { min, max }] of Object.entries(CONTROLS))
    recipe[key] = number(value[key], min, max, key);
  recipe.decay = number(value.decay, 0.01, 4, 'decay');
  recipe.sustain = number(value.sustain, 0, 1, 'sustain');
  if (value.kind === 'custom') recipe.graph = validateGraph(value.graph);
  else assert(value.graph === undefined, 'Only custom instruments can contain a synthesis graph.');
  return recipe;
}

export function noteName(midi) {
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

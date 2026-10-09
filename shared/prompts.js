import { KINDS, CONTROLS, preset, validateRecipe } from './instruments.js';

const clone = (value) => structuredClone(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Deliberately bounded and deterministic. Prompts never become executable code.
export function interpretPrompt(prompt, current) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1000)
    throw new Error('Describe a sound in 1–1000 characters.');
  const text = prompt.toLowerCase();
  const kind = KINDS.find((word) => new RegExp(`\\b${word}\\b`).test(text));
  const recipe =
    kind && kind !== current?.kind ? preset(kind) : clone(current || preset(kind || 'bass'));
  const changes = [];
  if (kind) changes.push(`${kind} instrument`);
  const apply = (pattern, description, update) => {
    if (pattern.test(text)) {
      update();
      changes.push(description);
    }
  };
  apply(/\b(sine|sinusoidal)\b/, 'sine oscillator', () => {
    recipe.wave = 'sine';
  });
  apply(/\b(saw|sawtooth)\b/, 'saw oscillator', () => {
    recipe.wave = 'saw';
  });
  apply(/\b(square|pulse|hollow)\b/, 'pulse oscillator', () => {
    recipe.wave = 'pulse';
  });
  apply(/\btriangle\b/, 'triangle oscillator', () => {
    recipe.wave = 'triangle';
  });
  apply(/\b(warm|dark|round|rounder|mellow)\b/, 'lower filter cutoff', () => {
    recipe.brightness *= 0.65;
  });
  apply(/\b(bright|brighter|sharp|crisp)\b(?!\s+attack)/, 'higher filter cutoff', () => {
    recipe.brightness *= 1.5;
  });
  apply(/\b(distort\w*|gritty|aggressive|dirty)\b/, 'more drive', () => {
    recipe.drive += /\b(slightly|little)\b/.test(text) ? 0.1 : 0.3;
  });
  apply(/\b(clean|cleaner|less distortion)\b/, 'less drive', () => {
    recipe.drive -= 0.2;
  });
  apply(/\b(sharp|fast|quick|snappy)\s+attack\b/, 'fast attack', () => {
    recipe.attack = 0.004;
  });
  apply(/\b(soft|slow|slower|gentle)\s+attack\b/, 'slower attack', () => {
    recipe.attack = Math.max(0.15, recipe.attack * 1.5);
  });
  apply(/\b(short\w*|tight)\s+(the\s+)?release\b/, 'shorter release', () => {
    recipe.release *= 0.5;
  });
  apply(/\b(long\w*|sustain\w*)\s+(the\s+)?release\b/, 'longer release', () => {
    recipe.release *= 1.7;
  });
  apply(/\b(wide|wider|detuned|lush)\b/, 'more detuning', () => {
    recipe.detune += 0.005;
  });
  apply(/\bshort\b(?!\s+(the\s+)?release)/, 'shorter decay', () => {
    recipe.decay *= 0.6;
  });
  if (!changes.length)
    throw new Error(
      'No supported sound words found. Try bass, pad, pluck, kick, snare, hat, warm, bright, gritty, hollow, fast attack, or shorter release.',
    );
  for (const [key, { min, max }] of Object.entries(CONTROLS))
    recipe[key] = clamp(recipe[key], min, max);
  recipe.decay = clamp(recipe.decay, 0.01, 4);
  return {
    recipe: validateRecipe(recipe),
    changes,
    explanation: `Local interpretation: ${changes.join(', ')}. Other wording is not interpreted.`,
  };
}

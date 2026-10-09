import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preset,
  interpretPrompt,
  synthDef,
  validateProject,
  defaultProject,
  makeTrack,
  KINDS,
  WAVES,
} from '../shared/music.js';
import { encodeOSC, decodeOSC } from '../server/osc.js';

test('sound refinement changes only the requested controls', () => {
  const before = preset('bass');
  const { recipe } = interpretPrompt('Make it rounder and shorten the release', before);
  assert.equal(recipe.brightness, before.brightness * 0.65);
  assert.equal(recipe.release, before.release * 0.5);
  for (const key of Object.keys(before).filter((key) => !['brightness', 'release'].includes(key)))
    assert.equal(recipe[key], before[key]);
  assert.deepEqual(before, preset('bass'), 'input must not be mutated');
});
test('the proposed bass prompt produces a reusable instrument', () => {
  const { recipe, explanation } = interpretPrompt(
    'A warm, slightly distorted bass with a sharp attack',
  );
  assert.equal(recipe.kind, 'bass');
  assert.equal(recipe.attack, 0.004);
  assert.equal(recipe.drive, 0.25);
  assert.match(explanation, /Other wording is not interpreted/);
  const code = synthDef('t_bass', recipe);
  assert.match(code, /freq = 110/);
  assert.match(code, /Env.adsr/);
  assert.match(code, /gate, doneAction: 2/);
});
test('unsupported descriptions fail clearly rather than claiming interpretation', () => {
  assert.throws(() => interpretPrompt('A celestial watermelon'), /No supported sound words/);
  assert.throws(() => interpretPrompt(''), /Describe a sound/);
});
test('repeated refinements stay inside valid synthesis bounds', () => {
  let recipe = preset('pluck');
  for (let i = 0; i < 100; i++)
    recipe = interpretPrompt('A short, bright, gritty pluck with a shorter release', recipe).recipe;
  assert.equal(recipe.decay, 0.01);
  assert.equal(recipe.release, 0.02);
  assert.equal(recipe.brightness, 12000);
  assert.equal(recipe.drive, 1);
  assert.doesNotThrow(() => synthDef('t_pluck', recipe));
});
test('explicit instrument changes choose appropriate defaults', () => {
  const { recipe } = interpretPrompt('A lush pad with a slow attack', preset('kick'));
  assert.equal(recipe.kind, 'pad');
  assert.ok(recipe.sustain > 0);
  assert.ok(recipe.detune > 0.009);
});
test('projects round-trip exact definitions, history, and note data', () => {
  const project = defaultProject();
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  for (const kind of KINDS)
    for (const wave of WAVES) {
      const track = makeTrack(kind, 't_test', 'Test');
      track.recipe.wave = wave;
      track.code = synthDef(track.id, track.recipe);
      assert.doesNotThrow(() => validateProject({ ...project, tracks: [track] }));
    }
});
test('import rejects executable code, invalid controls, duplicate IDs, and unbounded notes', () => {
  const mutate = (fn, pattern) => {
    const project = defaultProject();
    fn(project);
    assert.throws(() => validateProject(project), pattern);
  };
  mutate((p) => {
    p.tracks[0].code += '"touch /tmp/unsafe".unixCmd;';
  }, /does not match/);
  mutate((p) => {
    p.tracks[0].history[0].code += '0.exit;';
  }, /does not match/);
  mutate((p) => {
    p.tracks[1].id = p.tracks[0].id;
  }, /duplicate instrument/);
  mutate((p) => {
    p.tracks[0].recipe.brightness = Infinity;
  }, /brightness/);
  mutate((p) => {
    p.tracks[0].notes[0].length = 33;
  }, /note length/);
  mutate((p) => {
    p.tracks[0].notes[0].midi = 36.5;
  }, /whole steps/);
  mutate((p) => {
    p.tracks[0].notes[1].id = p.tracks[0].notes[0].id;
  }, /duplicate note/);
  const reservedTrack = makeTrack('bass', 't_preview', 'Reserved');
  assert.throws(
    () => validateProject({ ...defaultProject(), tracks: [reservedTrack] }),
    /instrument ID/,
  );
  assert.throws(() => synthDef('bad); 0.exit;', preset()), /Invalid instrument ID/);
});
test('OSC messages round-trip strings, signed integers, and floats', () => {
  for (let length = 0; length < 16; length++) {
    const message = decodeOSC(encodeOSC('/scmaker/test', ['x'.repeat(length), -2, 0.25, 'hello']));
    assert.deepEqual(message, {
      address: '/scmaker/test',
      args: ['x'.repeat(length), -2, 0.25, 'hello'],
    });
  }
  assert.throws(() => decodeOSC(Buffer.from('truncated')), /Invalid OSC/);
});

import { validateRecipe } from './instruments.js';
import { graphSource } from './synthesis-graph.js';

export function synthDef(id, recipe) {
  if (!/^t_[a-z0-9_]{1,40}$/.test(id)) throw new Error('Invalid instrument ID.');
  const r = validateRecipe(recipe);
  const oscillators = {
    sine: 'SinOsc.ar(freq * [1 - detune, 1 + detune])',
    saw: 'Saw.ar(freq * [1 - detune, 1 + detune])',
    pulse: 'Pulse.ar(freq * [1 - detune, 1 + detune], 0.45)',
    triangle: 'LFTri.ar(freq * [1 - detune, 1 + detune])',
  };
  let source = oscillators[r.wave];
  if (r.kind === 'kick') source = 'SinOsc.ar(freq * EnvGen.kr(Env([3, 1], [0.045], -6))) ! 2';
  if (r.kind === 'snare')
    source = '(HPF.ar(WhiteNoise.ar(0.7), 700) + SinOsc.ar(180, 0, 0.25)) ! 2';
  if (r.kind === 'hat') source = 'HPF.ar(WhiteNoise.ar(0.55), 6500) ! 2';
  const graph = r.kind === 'custom' ? graphSource(r.graph) : null;
  if (graph) source = graph.output;
  // Keep whitespace stable: saved projects validate against this canonical definition.
  return `// SCMaker: ${r.kind}. Velocity controls amplitude; gate controls note length.
SynthDef(\\${id}, { |out = 0, freq = 110, amp = 0.16, gate = 1, brightness = ${r.brightness}, drive = ${r.drive}, attack = ${r.attack}, decay = ${r.decay}, sustain = ${r.sustain}, release = ${r.release}, detune = ${r.detune}|
    var signal, envelope${graph ? `, ${graph.variables}` : ''};
${graph ? `${graph.lines}\n` : ''}    signal = ${source};
    signal = LPF.ar(signal, brightness.clip(120, 18000));
    signal = (signal * (1 + (drive * 8))).tanh / (1 + (drive * 2));
    envelope = EnvGen.kr(Env.adsr(attack, decay, sustain, release), gate, doneAction: 2);
    Out.ar(out, signal * envelope * amp);
}).add;
`;
}

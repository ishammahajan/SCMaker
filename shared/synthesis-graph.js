import { assert, number } from './validation.js';

// Fixed arity and backward-only references bound both compilation and DSP cost.
export const GRAPH_OPS = {
  sine: 1,
  saw: 1,
  pulse: 2,
  triangle: 1,
  noise: 0,
  lfo: 1,
  add: 2,
  multiply: 2,
  lowpass: 2,
  highpass: 2,
  bandpass: 3,
  formant: 3,
};
const controls = ['freq', 'brightness', 'detune'];

export function validateGraph(value) {
  assert(
    value && Array.isArray(value.nodes) && value.nodes.length >= 1 && value.nodes.length <= 32,
    'Use 1–32 synthesis nodes.',
  );
  const nodes = value.nodes.map((node, index) => {
    assert(
      node &&
        typeof node.op === 'string' &&
        Object.hasOwn(GRAPH_OPS, node.op) &&
        Array.isArray(node.args) &&
        node.args.length === GRAPH_OPS[node.op],
      'Invalid synthesis operation.',
    );
    const args = node.args.map((arg) => {
      if (typeof arg === 'number') return number(arg, -20000, 20000, 'synthesis constant');
      assert(
        typeof arg === 'string' &&
          (controls.includes(arg) || (/^n\d+$/.test(arg) && Number(arg.slice(1)) < index)),
        'Invalid synthesis reference.',
      );
      return controls.includes(arg) ? arg : `n${Number(arg.slice(1))}`;
    });
    return { op: node.op, args };
  });
  return { nodes };
}

export function graphSource(graph) {
  const { nodes } = validateGraph(graph);
  const lines = nodes.map(({ op, args }, i) => {
    const [a, b, c] = args.map(String);
    const hz = (x) => `(${x}).clip(20, 18000)`;
    const expressions = {
      sine: `SinOsc.ar(${hz(a)})`,
      saw: `Saw.ar(${hz(a)})`,
      triangle: `LFTri.ar(${hz(a)})`,
      pulse: `Pulse.ar(${hz(a)}, (${b}).clip(0.05, 0.95))`,
      noise: 'WhiteNoise.ar(1)',
      lfo: `SinOsc.kr((${a}).clip(0.01, 40))`,
      add: `(${a} + ${b}).clip(-20000, 20000)`,
      multiply: `(${a} * ${b}).clip(-20000, 20000)`,
      lowpass: `LPF.ar((${a}).asAudioRateInput, ${hz(b)})`,
      highpass: `HPF.ar((${a}).asAudioRateInput, ${hz(b)})`,
      bandpass: `BPF.ar((${a}).asAudioRateInput, ${hz(b)}, (${c}).clip(0.02, 1))`,
      formant: `Formant.ar(${hz(a)}, ${hz(b)}, (${c}).clip(20, 10000))`,
    };
    return `    n${i} = ${expressions[op]};`;
  });
  return {
    variables: nodes.map((_, i) => `n${i}`).join(', '),
    lines: lines.join('\n'),
    output: `LeakDC.ar(n${nodes.length - 1}.asAudioRateInput).tanh ! 2`,
  };
}

import { randomUUID } from 'node:crypto';
import { preset, validateRecipe } from '../shared/instruments.js';
import { synthDef } from '../shared/synthdef.js';
import { GRAPH_OPS } from '../shared/synthesis-graph.js';
import { text } from '../shared/validation.js';

export const LLM_MODEL = 'muse-spark-1.3-contributor';
const endpoint = 'https://opencode.ai/zen/go/v1/responses';
const instructions = `You design playable SuperCollider instruments. Return ONLY a JSON object with explanation (1–1000 characters) and recipe (changed fields).
For create mode, build a NEW custom synthesis graph, not a stock preset. For refine mode, preserve the existing graph and unrelated controls unless the requested change needs them altered. Understand typos such as whisling and yodling. Describe synthesized vocal approximations honestly, not realistic recorded vocals.
The recipe fields are kind, wave, brightness (120–12000 Hz), drive (0–1), attack (0.002–2 s), decay (0.01–4 s), sustain (0–1), release (0.02–4 s), detune (0–0.03), graph.
Custom sounds use kind="custom"; wave is a legacy field, use "sine". graph={"nodes":[{"op":"sine","args":["freq"]}]}.
Allowed operations and argument counts: ${JSON.stringify(GRAPH_OPS)}.
Use 1–32 nodes. Arguments are finite numeric constants -20000 to 20000, "freq" (played note Hz), "brightness", "detune", or "n0", "n1", etc referring ONLY to earlier nodes. Last node is the mono output. No code, expressions, variables, nested objects or extra operations.
sine/saw/triangle take frequency Hz; pulse takes frequency, width; noise takes no args; lfo is a bipolar sine at 0.01–40 Hz; add/multiply take two signals; lowpass/highpass take signal, cutoff Hz; bandpass takes signal, center Hz, reciprocal Q (0.02–1); formant takes fundamental Hz, formant Hz, bandwidth Hz.
Use add/multiply with lfo to build vibrato, tremolo, or yodel pitch modulation. Use formant nodes and mixing for vowel-like tones. Use noise mixed quietly with sine for breathy whistles. All sounds receive an ADSR, lowpass, drive and velocity stage automatically. Keep sensible amplitude and avoid excessive saturation. Never return SuperCollider source.`;

export function createLlmInstruments({
  apiKey = process.env.OPENCODE_API_KEY,
  fetchImpl = fetch,
} = {}) {
  let busy = false;
  const sessionId = randomUUID();
  return async function generate(prompt, current, mode = 'refine') {
    text(prompt, 1000, 'sound description');
    if (!['create', 'refine'].includes(mode)) throw new Error('Invalid prompt mode.');
    const base = mode === 'create' ? preset('custom') : validateRecipe(current || preset('custom'));
    if (!apiKey)
      throw new Error(
        'AI instruments need OPENCODE_API_KEY in .env. Set it and restart SCMaker, or choose Local vocabulary.',
      );
    if (busy)
      throw new Error('An AI instrument request is already running. Try again when it finishes.');
    busy = true;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SCMaker/0.1 (instrument-code-generator)',
          'x-opencode-session': sessionId,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          instructions,
          input: JSON.stringify({ mode, prompt, current: base }),
          max_output_tokens: 8000,
          reasoning: { effort: 'xhigh' },
          store: false,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => { });
        throw new Error(
          `OpenCode Go request failed (HTTP ${response.status}). Check your API key, subscription and model access.`,
        );
      }
      // Bound provider output without ever logging provider bodies or credentials.
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 256000) throw new Error('AI response is too large.');
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.status === 'incomplete' || result.error)
        throw new Error('AI response was incomplete. Try a simpler description.');
      const content =
        result.output
          ?.filter((item) => item.type === 'message')
          .flatMap((item) => item.content || [])
          .filter((item) => item.type === 'output_text')
          .map((item) => item.text)
          .join('') || result.output_text;
      if (typeof content !== 'string') throw new Error('AI did not return an instrument.');
      const parsed = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
      if (!parsed.recipe || typeof parsed.recipe !== 'object' || Array.isArray(parsed.recipe))
        throw new Error('Invalid AI recipe.');
      const recipe = validateRecipe({ ...base, ...parsed.recipe });
      if (mode === 'create' && recipe.kind !== 'custom')
        throw new Error('AI did not create a custom instrument.');
      synthDef('t_preview', recipe);
      return {
        recipe,
        explanation: text(parsed.explanation, 1000, 'AI explanation'),
        provider: 'OpenCode Go',
        model: LLM_MODEL,
      };
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        /^(OpenCode Go|AI |Invalid |Use 1–32|Only custom|Unknown instrument)/.test(error.message)
      )
        throw error;
      throw new Error(
        'AI instrument generation failed or timed out. Your current sound is unchanged. Try again.',
      );
    } finally {
      busy = false;
    }
  };
}

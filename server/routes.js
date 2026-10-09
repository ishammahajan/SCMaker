import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { validateProject, validateRecipe, interpretPrompt } from '../shared/music.js';
import { sendJson as json, validNumber } from './http.js';

export function createApiRoutes({ engine, projects, token, dataDir, generateInstrument }) {
  async function post(pathname, input, response) {
    if (pathname === '/api/prompt') {
      const current = input.current ? validateRecipe(input.current) : undefined;
      if (input.provider === 'llm')
        return json(response, 200, await generateInstrument(input.prompt, current, input.mode));
      if (input.provider !== undefined && input.provider !== 'local')
        throw new Error('Unknown prompt provider.');
      if (current?.kind === 'custom')
        throw new Error(
          'Choose AI to refine a custom instrument. Direct controls also remain available.',
        );
      return json(response, 200, interpretPrompt(input.prompt, current));
    }
    if (['/api/project', '/api/sync', '/api/play'].includes(pathname)) {
      const project = validateProject(input.project);
      if (pathname === '/api/project') {
        await projects.save(project);
        return json(response, 200, { saved: true });
      }
      await engine.run(() =>
        pathname === '/api/play' ? engine.play(project) : engine.sync(project),
      );
      return json(response, 200, engine.status());
    }
    if (pathname === '/api/notes/start') {
      const project = validateProject(input.project);
      if (
        !project.tracks.some((track) => track.id === input.trackId) ||
        !validNumber(input.velocity, 0.05, 1)
      )
        throw new Error('Invalid note recording input.');
      await engine.run(() => engine.startNoteCapture(project, input.trackId, input.velocity));
      return json(response, 200, engine.status());
    }
    if (pathname === '/api/stop') {
      await engine.run(() => engine.stop());
      return json(response, 200, engine.status());
    }
    if (pathname === '/api/audition') {
      const recipe = validateRecipe(input.recipe);
      const midi = input.midi ?? 48;
      const reverb = input.reverb ?? 0.05;
      if (!Number.isInteger(midi) || !validNumber(midi, 24, 96) || !validNumber(reverb, 0, 1))
        throw new Error('Invalid audition pitch or reverb.');
      await engine.run(() => engine.audition(recipe, midi, reverb));
      return json(response, 200, { ok: true });
    }
    if (pathname === '/api/note') {
      if (
        typeof input.on !== 'boolean' ||
        !/^[a-z0-9_]{1,60}$/.test(input.voiceId) ||
        !Number.isInteger(input.midi) ||
        !validNumber(input.midi, 24, 96)
      )
        throw new Error('Invalid note input.');
      const project = validateProject(input.project);
      const track = project.tracks.find((track) => track.id === input.trackId);
      if (!track) throw new Error('Unknown instrument.');
      await engine.run(() => engine.note(track, input.midi, input.voiceId, input.on));
      return json(response, 200, { ok: true });
    }
    if (pathname === '/api/record/start') {
      const name = await engine.run(() => engine.startRecording());
      return json(response, 200, { name });
    }
    if (pathname === '/api/record/stop') {
      const name = await engine.run(() => engine.stopRecording());
      return json(response, 200, { name, url: `/api/recordings/${name}` });
    }
    return json(response, 404, { error: 'Unknown API endpoint.' });
  }
  async function get(pathname, response) {
    if (pathname === '/api/session') return json(response, 200, { token });
    if (pathname === '/api/status') return json(response, 200, engine.status());
    if (pathname === '/api/project') {
      try {
        return json(response, 200, await projects.load());
      } catch (error) {
        return json(response, 422, {
          error: `Saved project could not be opened: ${error.message}. Your file has not been changed.`,
        });
      }
    }
    if (pathname.startsWith('/api/recordings/')) {
      const name = pathname.slice('/api/recordings/'.length);
      if (!/^take-[0-9TZ-]+\.wav$/.test(name) || engine.recording === name)
        return json(response, 404, { error: 'Recording is unavailable or still open.' });
      const file = path.join(dataDir, 'recordings', name);
      const size = (await stat(file)).size;
      response.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': size,
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      // Recordings may be large. Stream instead of buffering them in memory.
      createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
      return;
    }
    return json(response, 404, { error: 'Not found.' });
  }
  return { get, post };
}

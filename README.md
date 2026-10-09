# SCMaker

A local, prompt-driven music workstation with a web interface and **real SuperCollider synthesis**. Describe an instrument, audition a revision, keep it, and write its notes in a piano roll.

This is the first working prototype, not a complete DAW. It starts with a small bass, kick, and pad sketch. Nothing plays until you press Play or audition a sound.

## Run

Requirements: Node.js 22 or newer, SuperCollider (`sclang` and `scsynth`), and a working audio device. Install FFmpeg (`ffmpeg` on PATH) for MP3 and FLAC recording; WAV works without it. This build has been tested on Linux with PipeWire's JACK compatibility layer.

```sh
npm install
npm start
```

Open **http://127.0.0.1:3210**. Wait for “SuperCollider connected” in the footer, then press Play. Audio comes from SuperCollider on your computer, not from a browser audio player.

On Linux, the app uses `pw-jack` when available. For a conventional JACK setup, use:

```sh
SCMAKER_USE_PW_JACK=0 npm start
```

Configuration:

| Variable              | Default   | Purpose                                        |
| --------------------- | --------- | ---------------------------------------------- |
| `OPENCODE_API_KEY`    | unset     | Server-only OpenCode Go key for AI instruments |
| `PORT`                | `3210`    | Local HTTP port                                |
| `SCMAKER_DATA_DIR`    | `./data`  | Project and recording directory                |
| `SCLANG_PATH`         | `sclang`  | Executable name or absolute path               |
| `SCMAKER_USE_PW_JACK` | automatic | Set to `0` to skip `pw-jack`                   |

The engine uses its own dynamically allocated OSC ports. It does not take over an existing SuperCollider session. Stop the app with Ctrl+C to close its engine and any recording.

## Make a sketch

The main workspace is for composing: tracks and mix controls on the left, the piano roll in the center, and a playable keyboard below it. Sound design lives in a separate **Sound Workshop** dialog.

1. Select an instrument on the left, or add one. There can be up to four. Adding an instrument opens its workshop.
2. Click the piano roll to add notes. Select a note to set its length and velocity. Double-click it or use **Delete note** to remove it.
3. Play the keyboard or hold computer keys `A W S E D F T G Y H U J K`.
4. Adjust each instrument's level, mute, and reverb in the main workspace.
5. Choose **Edit sound** to open the selected instrument's workshop. Type a description and choose **Build preview**, then compare **Current** and **Preview**. Choose **Keep this sound** to apply the revision. Fine-tuning sliders change the current sound directly.
6. Choose **Back to music** or press Escape to close the workshop. Closing does not apply a preview or stop playback. An unapplied preview remains available when reopening the same instrument's workshop; switching instruments discards it.
7. Save the project, or export a portable `.json` file. **Open project file** imports an exported project. **New empty project** removes the starter sketch from your working state.
8. Press **Record**, then play your music. **Finish take** closes the stereo WAV and provides a download link. Recording also captures auditioned sounds.

To record sequence notes, select an instrument and choose **Record notes** beside the piano roll controls. After four count-in clicks, play the computer keyboard for one two-bar loop. Releasing a key adds its note to the grid. Starts and ends snap to sixteenth steps, with a minimum length of one step and the current **Velocity** setting. Recording stops automatically at the loop boundary; **Stop**, Escape, or **Stop recording notes** finishes early. Existing notes stay intact. Same-pitch overlaps and notes beyond the 256-note track limit are skipped, with a summary when the take finishes. Save explicitly to keep the new notes. Press **R** to start or stop note recording. **Ctrl+R** removes only the notes added by the selected instrument's previous pass and starts a new count-in. Older and manually added notes are preserved, and a failed restart does not delete the previous pass. Pass history lasts for the current browser session and resets when opening or starting another project. These shortcuts are inactive while typing or using a dialog; Ctrl+R overrides browser reload only in the music workspace. The separate **Record** button still records stereo audio, not sequence notes.

Keyboard shortcuts in the music workspace: Space toggles playback, Escape stops, and `1–4` select instruments. Ctrl+S or Cmd+S saves, including from the workshop. While a dialog is open, music and track shortcuts are inactive; Escape closes the dialog instead. In the piano roll, use arrow keys to navigate empty cells and Enter to add a note.

In the workshop, the history menu restores earlier instrument versions without changing their sequences. The **SynthDef** panel displays the exact current definition and exports an editable `.scd` file. This version does not execute custom code entered or imported through the browser.

## What prompts understand

### AI custom instruments

Set `OPENCODE_API_KEY` in the root `.env` file (see `.env.example`) and restart `npm start`.
The key stays on the server. `.env` is ignored and never served to the browser.
If a key was shared in a conversation, replace it before regular use.

Add an instrument with **Custom · describe with AI**, then describe a sound such as
“A breathy whisling instrument with natural vibrato” or “A yodling voice with changing vowels.”
The default AI interpreter uses OpenCode Go's **`muse-spark-1.3-contributor`** model.
Choose **Create a new custom sound** to replace the synthesis design, or **Refine current
instrument** to modify it. After keeping a creation, the action switches to Refine.
Compare Current and Preview before keeping a change. Notes stay unchanged. Accepted sounds
and their history are saved in the project and work without further provider requests.

The model designs a bounded synthesis graph with oscillators, noise, modulation, filters,
and formants. SCMaker validates it and compiles a canonical SuperCollider SynthDef.
It does not execute model-written source code. Custom graphs can have up to 32 nodes.
Envelope, brightness, drive, and detune controls remain available (detune only affects
custom graphs that reference it). The stock oscillator selector is disabled for custom graphs.
Whistling and yodelling are **synthesized approximations**, not human vocal recordings.

Requests send only the description, action, and current sound recipe to OpenCode Go.
**The Contributor model permits prompts and completions to be used for training and is
not zero-retention.** It also has regional availability restrictions. See
[OpenCode Go privacy and client requirements](https://opencode.ai/docs/go/).
The client identifies itself as SCMaker and sends a stable per-server session ID.
Provider requests are limited to one at a time, with a two-minute timeout and no automatic
retries or model substitution. Failures leave the current sound unchanged. Check your key,
subscription, regional access, or usage limits if a request fails.

### Offline local vocabulary

Choose **Local vocabulary · no network** for the original bounded deterministic interpreter.
It does not refine custom synthesis graphs. Use AI or direct controls for those.

| Sound property | Examples                                               |
| -------------- | ------------------------------------------------------ |
| Instrument     | bass, pad, pluck, kick, snare, hat                     |
| Oscillator     | sine, saw, pulse, triangle, hollow                     |
| Filter         | warm, dark, rounder, bright, brighter                  |
| Drive          | slightly distorted, gritty, aggressive, clean, cleaner |
| Attack         | sharp attack, fast attack, soft attack, slow attack    |
| Release        | shorter release, longer release                        |
| Detuning       | wide, detuned, lush                                    |

Try “A warm, slightly distorted bass with a sharp attack,” followed by “Make it rounder and shorten the release.” Refinements change the matching controls and preserve the others. Naming a different instrument kind selects that kind's starting recipe. Drums have fixed sine/noise sources, so their oscillator selector is disabled.

Each preview explains which changes it interpreted. Unmatched wording is ignored, and a prompt with no supported words reports an error. Negation and nuanced descriptions are not generally understood. Judge the sound by auditioning it.

## Files and recovery

- `data/project.json` is the last explicitly saved project. It contains instrument recipes, exact generated SynthDefs, sound history, notes, tempo, levels, mute states, and reverb settings.
- Choose **MP3** (the default), **WAV**, or **FLAC** beside **Record** before starting a stereo audio take. The format is locked while recording. MP3 uses 192 kbps; FLAC is lossless. Finished takes have a download link.
- `data/recordings/` contains the original stereo, 16-bit PCM WAV takes and any converted MP3 or FLAC files. SuperCollider records WAV internally, then FFmpeg converts finished takes. The original WAV is retained, including if conversion fails. If FFmpeg is unavailable, install it or select WAV.
- `data/engine.scd` is a generated engine bootstrap, not an instrument library. It contains a per-run bridge secret. Do not share it.

Unsaved edits are not automatically persisted. The browser warns before closing with unsaved changes. Export projects to keep multiple named sketches. Reopening a saved project does not reinterpret its prompts.

If the engine fails, open **Engine log** in the footer. Check that `sclang` is on your PATH and that JACK/PipeWire can open an output device, then restart the app. The interface can still save and export a project while audio is unavailable. If a saved project is corrupt, the UI reports that failure and shows an unsaved starter; it does not overwrite your file automatically.

## Checks

```sh
npm test                         # Portable model, validation, OSC, and HTTP tests
npm run test:audio                # Actual SuperCollider synthesis and non-silent stereo WAV
npx playwright install chromium  # One-time browser installation
npm run test:browser              # Browser workflow, recording, reload, mobile, and keyboard checks
npm run format:check
```

The audio and browser integration checks need SuperCollider and a working audio device. They make a short sound. Browser tests use a separate project directory under `data/browser-test-*`, not your active saved project.

## Code structure

Start with `public/app.js` for browser composition and `server/app.js` for HTTP
composition. Browser features, shared music-domain logic, server responsibilities,
and component styles live in separate modules. The runtime remains dependency-free,
with no build step.

See [Code structure](docs/architecture.md) for the module map, dependency flow,
state ownership, and verification boundaries.

## Design and boundaries

The web UI uses native JavaScript modules. A Node server provides local HTTP APIs and a small authenticated OSC bridge to `sclang`. Validated recipes produce SynthDefs. SuperCollider's `TempoClock` and timestamped server bundles schedule the two-bar loop; browser timers only update the display. Reverb is per track, followed by a master limiter.

This was chosen over browser-only synthesis because SuperCollider is the intended engine and is already installed. Native modules and Node's built-ins avoid a framework/build pipeline for this small prototype. Runtime has no npm dependencies. The local interpreter makes the basic workflow usable without choosing a paid prompt provider. The optional AI interpreter extends validated recipes with bounded custom synthesis graphs.

The HTTP server binds only to `127.0.0.1`, validates Host and Origin, and requires a per-run token for mutations. Imports are checked before use, including exact code/recipe matching. Arbitrary SuperCollider code cannot be executed through an HTTP endpoint. This is a single-user local tool, not a remotely accessible or multi-user service. Run one editing browser session at a time.

Not implemented yet: full arrangements, live scene launching, unrestricted SynthDef code generation, MIDI input, custom code execution in the UI, and plugin hosting. The next product acceptance check is yours: make a minute of music you like, save it, reopen it, and continue with the same sounds.

SuperCollider references: [SynthDef](https://docs.supercollider.online/Classes/SynthDef.html), [TempoClock](https://docs.supercollider.online/Classes/TempoClock.html), and [server timing](https://docs.supercollider.online/Guides/ServerTiming.html).

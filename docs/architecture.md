# Code structure

SCMaker uses native browser modules and Node built-ins. There is no build step or
runtime framework. TypeScript checks JSDoc annotations during development only.
The browser edits version-two section-based songs. SuperCollider owns all musical
timing. Version-one loops remain readable without changes to their SynthDefs.

## Start here

- `public/app.js` composes the browser controllers and opens the studio.
- `server/index.js` starts the loopback server and handles process shutdown.
- `server/app.js` constructs the HTTP app. Tests can inject an engine here.
- `shared/music.js` is the stable entry point for music-domain exports.
- `shared/project.js` and `shared/playback.js` define the shared data shapes as JSDoc typedefs.

## Browser

```text
public/
  index.html                 Accessible page and dialog markup
  app.js                     Startup and cross-feature coordination
  api.js                     JSON requests and session-token handling
  state.js                   Current project, selected section/track, engine status
  features/
    tracks.js                Track selection, mix controls, adding instruments
    arrangement.js           Section editing, ordered section entries, repeats
    sound-editor.js          Prompt previews, direct controls, sound history
    keyboard.js              Audition keys and live voice release
    transport.js             Playback, recording, audio sync, status polling
    transport-view.js        Pure transport labels and control states
    note-recording.js        Apply captured notes to the armed project and track
    project-files.js         Save, import/export, dirty-state tracking
    shortcuts.js             Global shortcuts and window lifecycle events
    sequencer/
      index.js               Grid rendering, note editing, playhead display
      note-drag.js           Snapped previews and pointer-gesture cleanup
  ui/
    dom.js                   Small DOM, panel, and download helpers
    feedback.js              Notices and async event error handling
  style.css                  Ordered stylesheet imports
  styles/                    Base, component, and responsive rules
```

Each feature factory binds its own controls and returns a small controller API.
`app.js` passes the callbacks needed for coordination. There is no global event
bus, service registry, or controller import cycle.

`state.js` shares only the project, selected section and track IDs, and engine
status. `currentProject` exposes the selected section as a version-one snapshot,
so the sound and sequence editors work on that section's tracks. Each feature
keeps its transient state in its own closure, such as the sequencer's selected
note, the sound editor's unapplied draft, and the keyboard's held voices.

An edit updates the working project and calls `markDirty`, which marks it unsaved
and schedules an audio sync. Disk saves remain explicit. Note drags and sound
previews stay separate from the project until released or accepted.

`shortcuts.js` routes reserved keys in the capture phase. Modal dialogs, editable
fields, and native selects keep their own input; Space still controls playback.

The page is a viewport-height grid: transport, song strip, workspace, and status.
Scrolling regions contain their own overflow, and narrow screens turn the sidebar
into a popover drawer. Do not restore page scrolling or hide overflow without
keeping controls reachable. Add component styles to the matching file in their
cascade order, and cross-component viewport overrides to `styles/responsive.css`.

## Shared music domain

| Module               | Responsibility                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| `instruments.js`     | Instrument kinds, oscillators, control bounds, presets, recipe validation       |
| `prompts.js`         | Bounded deterministic interpretation and refinements                            |
| `synthesis-graph.js` | Bounded custom graph validation and fixed-operation source generation           |
| `synthdef.js`        | Canonical SynthDef generation from validated recipes                            |
| `project.js`         | Project types, limits, validation, legacy-to-song conversion, section snapshots |
| `playback.js`        | Engine status types, song and capture phase helpers, recording formats          |
| `validation.js`      | Small validation primitives                                                     |
| `music.js`           | Re-exports for existing consumers                                               |

These modules do not depend on the DOM, HTTP, or engine processes. Dependencies
flow from validation primitives to instruments, SynthDefs, and projects. Prompt
interpretation depends on instruments, not projects.

**Canonical SynthDef whitespace is part of the saved-file contract.** Validation
compares stored definitions with generated ones exactly. Keep
`tests/fixtures/project-v1.json` passing when editing the generator. Never pass
imported or prompted text to SuperCollider as code. Custom recipes store a
validated `graph` that trusted templates compile.

Version-two projects store `{ version, name, tempo, sections, arrangement }`. Each
section has independent tracks, sequences, sound history, and mix settings.
Arrangement entries reference sections by ID with a repeat count. Validation
bounds sections, entries, repeats, notes, and history, and rejects dangling
references. Track count is not capped; project requests are limited to 16 MiB and
other requests to 1 MiB. Opening a version-one loop converts it in memory only.

## Server and audio engine

| Module               | Responsibility                                                                   |
| -------------------- | -------------------------------------------------------------------------------- |
| `index.js`           | CLI entry point, loopback binding, shutdown                                      |
| `app.js`             | Construct and connect the server, routes, store, and engine                      |
| `http.js`            | Bounded JSON parsing, response helpers, error status mapping                     |
| `security.js`        | Security headers, Host/Origin checks, mutation authentication                    |
| `llm-instruments.js` | Server-only OpenCode Go Responses client, bounded output, graph validation       |
| `routes.js`          | Validate API inputs and call the store or serialized engine operations           |
| `project-store.js`   | Read validated projects and serialize atomic saves                               |
| `static-assets.js`   | Serve only explicitly allowlisted browser assets                                 |
| `engine.js`          | Manage processes, OSC replies, command queue, compilation cache, recording state |
| `supercollider.js`   | Build the bootstrap and internal SuperCollider commands                          |
| `osc.js`             | OSC encoding and decoding                                                        |

Requests pass Host/Origin checks before routing. Mutations also require the session
token and a JSON content type. Routes validate recipes and projects before calling
the engine, and engine operations run through `engine.run` to keep commands in
order. Prompt requests with `provider: "llm"` call the AI model; legacy requests
and `provider: "local"` use deterministic interpretation. AI generation does not
hold the engine queue or change a project, and
credentials never enter shared or browser code. See the
[README](../README.md#ai-custom-instruments) for provider privacy and configuration.

The static allowlist is intentional. Register each new browser module or stylesheet
in `server/static-assets.js`. Do not serve arbitrary repository files. Local
projects and the generated bootstrap secret stay in `data/`.

Engine invariants:

- SuperCollider schedules loops, arrangements, note capture, and live-note safety
  release. Browser polling only paints status and the playhead.
- Mixer channels are allocated by instrument ID and only for sounding instruments.
  Sequence updates are staged and swapped whole, and retiring channels outlive
  their release and reverb tails.
- Arranged playback uses a frozen snapshot. Workspace edits, live notes, and
  auditions cannot change an active take.
- Command batches stay within the OSC packet guard. Nothing is truncated to fit.
- Resource failures become `audioError`, stop playback, and still finalize
  song-owned recordings.
- Authenticated OSC replies report song position, completion, and captured notes.
  Generation IDs ignore stale replies.

## Verification

Use the commands in the [README](../README.md#checks). Behavior details are
specified by the tests:

| Area                                        | Tests                                                         |
| ------------------------------------------- | ------------------------------------------------------------- |
| Music validation, prompts, SynthDef fixture | `tests/music.test.js`, `tests/song.test.js`                   |
| HTTP trust boundary, routing, saves, assets | `tests/server.test.js`, `routing`, `project-store`, `assets`  |
| Recording, note capture, transport rules    | `tests/recording.test.js`, `note-recording`, `transport-view` |
| AI provider client                          | `tests/llm-instruments.test.js`                               |
| Real synthesis, songs, channel cleanup      | `tests/audio-check.js`                                        |
| Workflows, layout, shortcuts, drag, capture | `tests/browser/*.spec.js`                                     |

Audio and browser checks need SuperCollider, use isolated data, and produce sound.
UI acceptance remains a human check.

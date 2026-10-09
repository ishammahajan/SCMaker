# Code structure

SCMaker uses native browser modules and Node built-ins. There is no build step or
runtime framework. This structure separates existing responsibilities without
changing the UI, HTTP API, version-one project format, or SuperCollider scheduling.

## Start here

- `public/app.js` composes the browser controllers and opens the studio.
- `server/index.js` starts the loopback server and handles process shutdown.
- `server/app.js` constructs the HTTP app. Tests can inject an engine here.
- `shared/music.js` is the stable entry point for music-domain exports.

## Browser

```text
public/
  index.html                 Accessible page and dialog markup
  app.js                     Startup and cross-feature coordination
  api.js                     JSON requests and session-token handling
  state.js                   Current project, selected track, engine status
  features/
    tracks.js                Track selection, mix controls, adding instruments
    sound-editor.js          Prompt previews, direct controls, sound history
    keyboard.js              Audition keys and live voice release
    transport.js             Playback, recording, audio sync, status polling
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

Only the project, selected track ID, and engine status are shared in `state.js`.
Features keep transient state in their own closures: the sequencer owns its
selected note and octave view; the sound editor owns the unapplied draft; the
keyboard owns held voices; project files owns dirty-state and save revisions.

An edit updates the working project and calls `markDirty`. That marks the project
unsaved and schedules an audio sync through the transport controller. Disk saves
remain explicit. A note drag changes only its visual preview until release.
Sound previews likewise remain separate from the current recipe until accepted.

Styles retain their original cascade order: base, workspace, sound editor,
keyboard, sequencer, feedback, then responsive and reduced-motion overrides.
Add component rules to the matching file and cross-component viewport overrides
to `styles/responsive.css`.

## Shared music domain

| Module               | Responsibility                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `instruments.js`     | Instrument kinds, oscillator choices, control bounds, presets, recipe validation, note names |
| `prompts.js`         | Bounded deterministic interpretation and refinements                                         |
| `synthesis-graph.js` | Bounded custom graph validation and fixed-operation source generation                        |
| `synthdef.js`        | Canonical SynthDef generation from validated recipes                                         |
| `project.js`         | Project and history validation, track construction, starter sketch, loop/track limits        |
| `validation.js`      | Small validation primitives                                                                  |
| `music.js`           | Re-exports for existing consumers                                                            |

These modules do not depend on the DOM, HTTP, or engine processes. The dependency
flow is validation primitives → instruments → SynthDefs → projects. Prompt
interpretation depends on instruments, not projects.

**Canonical SynthDef whitespace is part of the saved-file contract.** Project
validation compares stored definitions to generated definitions exactly. Keep the
version-one compatibility fixture passing when editing the generator. Never pass
imported or prompted text to SuperCollider as executable code. Custom recipes add a
`graph` field to version-one projects. Its operations, numeric constants, and backward-only
references are validated, then compiled by trusted templates. Old stock definitions
remain byte-identical. Older SCMaker builds cannot open projects containing custom sounds.

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

Requests pass Host/Origin checks before routing. Mutations also require the
session token and JSON content type before the body is read. Routes validate
recipes and projects before invoking the engine. Engine operations run through
`engine.run` to preserve command ordering. AI generation does not hold the engine queue
or mutate a project. The explicit `provider: "llm"` prompt request calls Muse Spark;
legacy requests and `provider: "local"` retain deterministic interpretation. CLI startup
loads root `.env` with Node's native loader. Credentials never enter shared/browser code.
See the [README](../README.md#ai-custom-instruments) for provider privacy and configuration.

The static allowlist is intentional. When adding a browser module or stylesheet,
register it in `server/static-assets.js`. Do not replace this with arbitrary
repository-file serving. Generated bootstrap secrets and local projects belong in
`data/`, never in the public asset list.

SuperCollider owns musical timing. Browser polling only paints status and the
playhead. Keep audio scheduling and live-note safety release in SuperCollider.

Note recording uses a four-beat count-in and a single two-bar pass on the same
`TempoClock`. SuperCollider captures live key-down/up beats, aligns them with the
audible loop's bundle latency, quantizes to sixteenth steps, and clips held notes
at the end. Authenticated OSC replies carry completed notes to engine status.
`note-recording.js` applies each note once, preserves existing notes, rejects
same-pitch overlaps, and marks the working project unsaved. A take is attached to
the project and track armed at its start. Browser reloads do not replay old takes.
The recorder remembers the IDs it added in the last pass on each track, within
this project's browser session. R toggles note recording; Ctrl+R prepares a project
snapshot without those IDs and starts a replacement pass. The working notes are
removed only after the engine starts successfully. Imports and new projects reset
this transient history; no project-format changes are needed.
Audio sync is deferred during a take to keep the backing sequence and tempo fixed.
Live-note commands acknowledge evaluation without waiting for a second server
round trip; compilation and other commands still wait for server synchronization.

## Verification

Use the commands in the [README](../README.md#checks). The checks cover:

- Music interpretation, validation, OSC, and the local API trust boundary.
- A pre-refactor version-one project fixture, including exact SynthDef strings.
- Serialized atomic saves and preservation of corrupt files after failed reads.
- Serving every allowlisted asset and resolving module/stylesheet dependencies.
- Snapped note dragging, boundary moves, rejected drops, and gesture cancellation.
- Real SuperCollider synthesis, recording, save/reload, mobile layout, and shortcuts.
- Quantized keyboard note entry, chords, count-in cancellation, loop boundaries,
  early stop, focus loss, overlap preservation, and note-recording API validation.

Audio checks use isolated data and produce a short sound. The structural refactor
has no intended product behavior changes. UI acceptance remains a human check;
passing tests alone does not establish that every future workflow is covered.

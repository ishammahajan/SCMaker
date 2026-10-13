# Code structure

SCMaker uses native browser modules and Node built-ins. There is no build step or
runtime framework. The module structure separates responsibilities. Legacy version-one loops remain
readable without changes to their canonical SynthDefs. The browser works with
version-two section-based songs; SuperCollider owns loop and arrangement timing.

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
    arrangement.js           Section editing, ordered section entries, repeats
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

`shortcuts.js` routes reserved workstation keys in the capture phase before native
button activation. Save works across contexts. Modal dialogs, editable fields,
and native selects own their input, except that Space on workstation selects
controls playback. Sliders and focused buttons do not disable music shortcuts. Escape dismisses an open popover before stopping audio. Other
popover shortcuts follow the focused control's context. Enter activates buttons,
and unclaimed keys such as piano-roll arrows stay with their feature handlers.

Only the project, selected section/track IDs, and engine status are shared in `state.js`.
`currentProject` exposes the selected section as a legacy-shaped loop snapshot, so
existing sound and sequence editors work on that section's tracks.
Features keep transient state in their own closures: the sequencer owns its
selected note and octave view; the sound editor owns the unapplied draft; the
keyboard owns held voices and dock visibility; project files owns dirty-state and save revisions.
The arranger owns its entry-options selection and section-change busy guard. The
transport's Section/Song chooser selects loop or arranged playback, and manual or
automatic audio recording, without duplicating transport buttons.

The body is a viewport-height grid: transport, compact song strip, workspace, and
status. The sidebar instrument list, horizontal arrangement, piano roll, and narrow
note toolbar contain their own overflow. Only the selected instrument shows mix
sliders. On narrow screens the same sidebar becomes a native popover drawer.
Section and entry options are native popovers; sound design stays in its modal dialog.
Do not restore vertical stacking or hide overflow without keeping controls reachable.

An edit updates the working project and calls `markDirty`. That marks the project
unsaved and schedules an audio sync through the transport controller. Disk saves
remain explicit. A note drag changes only its visual preview until release.
Sound previews likewise remain separate from the current recipe until accepted.

Styles retain their original cascade order: base, workspace, sound editor,
keyboard, sequencer, feedback, then responsive and reduced-motion overrides.
Add component rules to the matching file and cross-component viewport overrides
to `styles/responsive.css`.

## Shared music domain

| Module               | Responsibility                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `instruments.js`     | Instrument kinds, oscillator choices, control bounds, presets, recipe validation, note names                  |
| `prompts.js`         | Bounded deterministic interpretation and refinements                                                          |
| `synthesis-graph.js` | Bounded custom graph validation and fixed-operation source generation                                         |
| `synthdef.js`        | Canonical SynthDef generation from validated recipes                                                          |
| `project.js`         | Loop/song and history validation, legacy-to-song conversion, section snapshots, track construction and limits |
| `validation.js`      | Small validation primitives                                                                                   |
| `music.js`           | Re-exports for existing consumers                                                                             |

These modules do not depend on the DOM, HTTP, or engine processes. The dependency
flow is validation primitives → instruments → SynthDefs → projects. Prompt
interpretation depends on instruments, not projects.

**Canonical SynthDef whitespace is part of the saved-file contract.** Project
validation compares stored definitions to generated definitions exactly. Keep the
version-one compatibility fixture passing when editing the generator. Never pass
imported or prompted text to SuperCollider as executable code. Custom recipes add a
`graph` field to version-one projects. Its operations, numeric constants, and backward-only
references are validated, then compiled by trusted templates. Old stock definitions
remain byte-identical. Older SCMaker builds cannot open projects containing custom sounds
or version-two song projects.

Version-two projects store `{ version, name, tempo, sections, arrangement }`.
Each section stores `{ id, name, tracks }`, with independent two-bar sequences,
recipes, history, and mix controls. Arrangement entries store `{ sectionId, repeats }`.
IDs are unique within a section; copied sections can retain track and note IDs.
Validation bounds section/entry counts, repeats, notes, and history and rejects dangling references.
There is no track-count ceiling. Project imports and project-bearing API requests
are bounded to 16 MiB; other request bodies retain their 1 MiB limit.
Opening a version-one loop converts it to one section in memory; disk saves are
still explicit and atomic.

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

`/api/song/play` and `/api/song/record` accept validated version-two projects.
Section loop, sync, and live-note endpoints accept validated version-one section
snapshots. Workspace channels are allocated dynamically by instrument ID, separate
from the preview/live-keyboard channel. Updates stage the complete next sequence
before swapping it, so increasing track count does not reroute existing voices.
Idle sync reclaims unused channels before allocating replacements. Live sync retains
retiring channels until a later idle sync to protect sustained voices.

Arranged playback compiles trusted definitions under distinct internal names for
sounding instruments in referenced sections. Each section pass allocates channels
only for its sounding instruments, then retires them after that section's release,
reverb, and latency allowance. Outgoing voices keep their own buses and mix settings
across section changes and repeats. The engine does not reserve all section mixers
up front. Workspace channels are freed and the preview strip silenced at song start
to exclude old loop/audition tails. Song resources are freed at the end or on Stop.

Trusted command fragments are batched within 48 kB, with a 60 kB OSC packet guard,
so larger projects do not overflow the UDP bridge or require a round trip per silent
instrument. No track or note is truncated to make a packet fit. SuperCollider's
node, memory, and bus bounds remain intact. Allocation exceptions and server `/fail`
messages reach engine status as `audioError`; active playback stops and song-owned
recordings finalize on failure rather than silently lose voices.

A single SuperCollider routine follows the frozen arrangement and repeats, then
waits for the longest release plus three seconds of reverb and bundle latency.
Authenticated OSC messages report the current entry, repetition, tail, and completion.
Completion triggers serialized recording finalization and optional conversion even
without a browser. Generation IDs prevent stale completion replies from finishing
a newer take. Stop also closes a song-owned recording; manual recordings retain
their existing explicit finish behavior. Workspace sync, live notes, and auditions
cannot alter an active arranged take.

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
- Legacy song conversion, independent section edits, arrangement validation,
  repeats/reordering, full-song save/reopen, and automatic recording finalization.
- Real arranged audio in every section/repetition and an audible ending release.
- Many-instrument validation and saves above 1 MiB, bounded OSC batching, and unused-section compilation.
- A 37-instrument, 32-entry workstation at laptop, phone, and short landscape sizes without document overflow or clipped transport controls.
- Fifth/sixth instrument audio in isolation, retired song-resource cleanup, actual bus exhaustion, failed-take finalization, and recovery.

Audio checks use isolated data and produce sound. UI acceptance remains a human check;
passing tests alone does not establish that every future workflow is covered.

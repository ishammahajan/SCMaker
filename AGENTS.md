# SCMaker project guidance

## Scope and layout

SCMaker is a single-user local web workstation backed by SuperCollider. It supports optional OpenCode Go AI generation of validated custom synthesis graphs and an explicitly labeled offline deterministic interpreter. Do not present the local interpreter as an LLM or replace SuperCollider with browser-only synthesis. Never execute model-written SuperCollider source. The Muse Spark Contributor model permits training on prompts and outputs; keep that disclosure visible.

- `public/app.js`: browser composition and startup. Feature controllers live in `public/features/`, DOM helpers in `public/ui/`, and ordered component styles in `public/styles/`.
- `server/llm-instruments.js`: server-only OpenCode Go provider integration. Keep the key in ignored `.env`, never browser code or logs.
- `shared/synthesis-graph.js`: bounded custom graph validation and trusted code templates.
- `shared/music.js`: stable export entry point. Domain implementations live in `shared/instruments.js`, `prompts.js`, `synthdef.js`, `project.js`, and `validation.js`.
- `server/index.js`: CLI startup. `server/app.js` composes security, API routes, project storage, static assets, and the managed SuperCollider engine.
- `docs/architecture.md`: module responsibilities, dependencies, and change boundaries.
- `tests/`: Node tests, a real-audio integration check, and Playwright workflow checks.
- `data/`: ignored local project/recording state. Do not commit it or expose the generated bootstrap secret.

## Commands and conventions

Use Node.js >=22 and native ES modules. Runtime has no npm dependencies. Formatting is defined in `.prettierrc.json`.

- `npm start`: loopback app at port 3210.
- `npm test`: portable unit/API checks.
- `npm run test:audio`: actual audio-engine integration, requires SuperCollider and working audio.
- `npm run test:browser`: Playwright on port 3211 with isolated data, also requires audio.
- `npm run format` and `npm run format:check`: Prettier.

The audio and browser checks produce a short sound. Do not use the user's saved project for tests. Linux uses `pw-jack` automatically when available; `SCMAKER_USE_PW_JACK=0` disables this.

## Contracts

Keep the prompt preview separate from the current instrument until accepted. Preserve unrelated recipe controls during refinement and preserve notes when restoring sound versions. Keep musical scheduling in SuperCollider, not browser timers.

Register new browser modules and stylesheets in the explicit allowlist in `server/static-assets.js`. Keep canonical SynthDef output byte-compatible with saved projects; `tests/fixtures/project-v1.json` covers the pre-refactor format.

Validate imported projects and numeric controls before generating or sending code. The HTTP API must remain loopback-only with Host/Origin checks and mutation authentication. There is no arbitrary-code execution endpoint. Project saves are explicit and atomic. Corrupt files must not be silently overwritten.

For substantive changes, run the applicable checks and review failures in the engine log as well as the browser. A UI-only simulation is not evidence that SuperCollider audio works.

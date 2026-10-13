// Engine playback phases shared by the server engine and the browser transport.

/**
 * @typedef {object} SongEntry
 * @property {string} sectionId
 * @property {number} repeats
 * @property {string} name
 *
 * @typedef {object} Song
 * @property {number} id
 * @property {'playing' | 'tail' | 'finishing' | 'finished'} phase
 * @property {boolean} recorded
 * @property {number} position Index into entries.
 * @property {number} repeat One-based repetition of the current entry.
 * @property {SongEntry[]} entries
 * @property {string} [name] Finished recording file name.
 * @property {string} [url]
 * @property {string} [error]
 *
 * @typedef {object} NoteCapture
 * @property {number} id
 * @property {string} trackId
 * @property {number} velocity
 * @property {'count-in' | 'recording' | 'finished'} phase
 * @property {number} countIn Remaining count-in beats.
 * @property {import('./project.js').Note[]} notes
 *
 * @typedef {object} EngineStatus
 * @property {'starting' | 'ready' | 'error' | 'closed'} state
 * @property {string | null} [error]
 * @property {string | null} [audioError]
 * @property {boolean} playing
 * @property {string | null} recording Open recording file name.
 * @property {NoteCapture | null} [noteCapture]
 * @property {Song | null} [song]
 * @property {number} step Current sixteenth step, or -1.
 * @property {number} [stepAt]
 * @property {string} [log]
 */

export const RECORDING_FORMATS = ['mp3', 'wav', 'flac'];

/** @param {Song | null | undefined} song */
export const isSongActive = (song) => ['playing', 'tail', 'finishing'].includes(song?.phase);

/** @param {NoteCapture | null | undefined} capture */
export const isCapturing = (capture) => Boolean(capture) && capture.phase !== 'finished';

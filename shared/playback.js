// Engine playback phases shared by the server engine and the browser transport.
export const RECORDING_FORMATS = ['mp3', 'wav', 'flac'];

export const isSongActive = (song) => ['playing', 'tail', 'finishing'].includes(song?.phase);

export const isCapturing = (capture) => Boolean(capture) && capture.phase !== 'finished';

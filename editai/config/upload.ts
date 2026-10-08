export const VIDEO_MIME_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;

export const AUDIO_MIME_TYPES = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
} as const;

export const MUSIC_MIME_TYPES = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
} as const;

export const MAX_AUDIO_COMMAND_MB = 20;
export const MAX_AUDIO_COMMAND_SECONDS = 180;
export const MAX_MUSIC_MB = 30;
export const MAX_INSTRUCTION_CHARS = 2000;

/** URLs assinadas expiram — nunca expomos o bucket publicamente. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const ACCEPTED_VIDEO_EXTENSIONS = ".mp4,.mov,.webm";

/** Normaliza o mime type que alguns browsers mandam com codecs. */
export function baseMime(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/**
 * Wire format for relayed audio.
 *
 * Discord voice wants 48 kHz, 2-channel, signed 16-bit little-endian PCM.
 * The bridge does no resampling, so devices must send exactly this. Getting
 * this wrong is the single most common cause of "it plays but sounds like
 * chipmunks / is half speed".
 */
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BYTES_PER_SAMPLE = 2;

/** Bytes of PCM that represent one second of audio. 192000 for the format above. */
export const AUDIO_BYTES_PER_SECOND =
  AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE;

/** Discord encodes in 20 ms frames; sending multiples of this keeps latency even. */
export const AUDIO_FRAME_MS = 20;
export const AUDIO_BYTES_PER_FRAME = (AUDIO_BYTES_PER_SECOND / 1000) * AUDIO_FRAME_MS;

export function msToBytes(ms: number): number {
  return Math.floor((AUDIO_BYTES_PER_SECOND * ms) / 1000);
}

export function bytesToMs(bytes: number): number {
  return Math.floor((bytes * 1000) / AUDIO_BYTES_PER_SECOND);
}

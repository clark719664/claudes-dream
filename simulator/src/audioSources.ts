import { spawn } from "node:child_process";
import { Readable } from "node:stream";
// ffmpeg-static ships its path as a default export typed loosely; narrow it here.
import ffmpegStatic from "ffmpeg-static";

const ffmpegPath = ffmpegStatic as unknown as string | null;
import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_CHANNELS,
  AUDIO_FRAME_MS,
  AUDIO_SAMPLE_RATE,
} from "@dmb/shared";

/**
 * A continuous test tone, paced at real time.
 *
 * Deliberately not a flat sine: the pitch steps every two seconds so you can
 * hear at once whether audio is stuttering, looping, or playing at the wrong
 * sample rate.
 */
export function toneSource(): Readable {
  const notes = [220, 277.18, 329.63, 440];
  let frame = 0;
  let phase = 0;

  return new Readable({
    read() {
      const buffer = Buffer.alloc(AUDIO_BYTES_PER_FRAME);
      const samplesPerFrame = AUDIO_BYTES_PER_FRAME / (AUDIO_CHANNELS * 2);
      const elapsedMs = frame * AUDIO_FRAME_MS;
      const freq = notes[Math.floor(elapsedMs / 2000) % notes.length]!;
      const step = (2 * Math.PI * freq) / AUDIO_SAMPLE_RATE;

      for (let i = 0; i < samplesPerFrame; i += 1) {
        phase += step;
        const value = Math.round(Math.sin(phase) * 0.25 * 32767);
        buffer.writeInt16LE(value, i * 4);
        buffer.writeInt16LE(value, i * 4 + 2);
      }
      frame += 1;

      // Pace to wall clock so the bridge sees a realistic live stream.
      setTimeout(() => this.push(buffer), AUDIO_FRAME_MS);
    },
  });
}

/** Decode any file or URL ffmpeg understands into the exact PCM the bridge wants. */
export function ffmpegSource(input: string): Readable {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary");

  const child = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel", "error",
      // Read at native speed; without this ffmpeg floods the bridge buffer.
      "-re",
      "-i", input,
      "-f", "s16le",
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-ac", String(AUDIO_CHANNELS),
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "inherit"] as const },
  );

  child.on("error", (error: Error) => {
    console.error(`ffmpeg failed to start: ${error.message}`);
  });

  const stream = child.stdout;
  stream.on("close", () => child.kill("SIGKILL"));
  return stream;
}

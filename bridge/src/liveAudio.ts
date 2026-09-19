import { Readable } from "node:stream";
import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_FRAME_MS,
  bytesToMs,
  msToBytes,
} from "@dmb/shared";

const SILENT_FRAME = Buffer.alloc(AUDIO_BYTES_PER_FRAME);

/**
 * A real-time PCM stream for one listener.
 *
 * Discord expects audio to arrive at wall-clock speed and never to end while
 * the bot is still connected. So this paces output on a 20 ms timer and
 * substitutes silence whenever the device hasn't sent enough yet. A stall on
 * the phone becomes a gap in the music rather than the bot leaving the
 * channel, which is what you want.
 */
export class LiveAudioStream extends Readable {
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private timer: NodeJS.Timeout | null = null;
  private primed = false;
  private stopped = false;

  constructor(
    private readonly prebufferBytes: number,
    private readonly maxBytes: number,
  ) {
    super({ highWaterMark: AUDIO_BYTES_PER_FRAME * 8 });
  }

  /** Called by the session whenever the device sends PCM. */
  push_pcm(chunk: Buffer): void {
    if (this.stopped) return;
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    if (!this.primed && this.queuedBytes >= this.prebufferBytes) this.primed = true;
    this.trim();
  }

  /**
   * Discard the oldest audio when a listener falls too far behind. For live
   * playback, being current matters more than being complete.
   */
  private trim(): void {
    while (this.queuedBytes > this.maxBytes && this.queue.length > 0) {
      const dropped = this.queue.shift();
      if (!dropped) break;
      this.queuedBytes -= dropped.length;
    }
  }

  get bufferedMs(): number {
    return bytesToMs(this.queuedBytes);
  }

  /** Pull exactly one frame, padding with silence if the queue is short. */
  private takeFrame(): Buffer {
    if (!this.primed || this.queuedBytes === 0) return SILENT_FRAME;

    const parts: Buffer[] = [];
    let needed = AUDIO_BYTES_PER_FRAME;

    while (needed > 0 && this.queue.length > 0) {
      const head = this.queue[0];
      if (!head) break;
      if (head.length <= needed) {
        parts.push(head);
        this.queue.shift();
        this.queuedBytes -= head.length;
        needed -= head.length;
      } else {
        parts.push(head.subarray(0, needed));
        this.queue[0] = head.subarray(needed);
        this.queuedBytes -= needed;
        needed = 0;
      }
    }

    if (needed > 0) {
      // Ran dry mid-frame. Pad rather than emit a short frame, which would
      // desynchronise the Opus encoder.
      parts.push(SILENT_FRAME.subarray(0, needed));
      this.primed = this.queuedBytes >= this.prebufferBytes;
    }

    return Buffer.concat(parts, AUDIO_BYTES_PER_FRAME);
  }

  override _read(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      if (this.stopped) return;
      // push() returning false is backpressure; we keep pacing regardless
      // because dropping live audio beats drifting behind real time.
      this.push(this.takeFrame());
    }, AUDIO_FRAME_MS);
    // Never hold the process open just for a listener.
    this.timer.unref?.();
  }

  override _destroy(error: Error | null, callback: (err: Error | null) => void): void {
    this.close();
    callback(error);
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.queuedBytes = 0;
    this.push(null);
  }
}

export function makeLiveAudioStream(prebufferMs: number, maxBufferMs: number): LiveAudioStream {
  return new LiveAudioStream(msToBytes(prebufferMs), msToBytes(maxBufferMs));
}

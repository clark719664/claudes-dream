// Camera plumbing for the barcode scanner. Two decode paths, both local:
//
//   1. BarcodeDetector, where the browser has it (Chrome, Edge, Android WebView) — fastest.
//   2. src/barcode.js over greyscale frames, everywhere else. iOS Safari has no
//      BarcodeDetector, so without this path every iPhone would be unable to scan.
//
// No network either way, and no library.

import { decodeGray, toEAN13 } from './barcode.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
/** Work at this width; more pixels cost frame rate without helping a 95-module symbol. */
const WORK_WIDTH = 640;
/** Scan the middle band, where someone aiming a phone puts the thing they are aiming at. */
const BAND = 0.5;
/** A code must be read twice running before it is accepted. */
const AGREE = 2;

export function cameraSupport() {
  const secure = typeof window !== 'undefined' && (window.isSecureContext ?? false);
  const api = !!navigator.mediaDevices?.getUserMedia;
  if (!api) {
    return {
      ok: false,
      reason: secure
        ? 'This browser does not offer camera access to web pages.'
        : 'The camera needs the page to be served over https. Open the hosted version, or serve the folder over https rather than from a file:// path.',
    };
  }
  if (!secure) {
    return {
      ok: false,
      reason:
        'The camera needs a secure page. Browsers only allow it over https or on localhost, so a file:// copy cannot scan — everything else still works.',
    };
  }
  return { ok: true, reason: '' };
}

export function permissionCopy(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it for this page in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is already in use by another app. Close that and try again.';
    default:
      return 'The camera could not be started. Type the digits underneath the barcode instead.';
  }
}

/**
 * Start scanning into `video`. Calls `onHit({code, format})` once a code has been read twice
 * in a row, and `onStatus(text)` with anything worth telling the person. Returns a handle
 * with stop() and, where the hardware allows, torch().
 */
export async function startScanner(video, { onHit, onStatus } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {
    /* some browsers resolve play() late; the frames still arrive */
  });

  const track = stream.getVideoTracks()[0];
  const canTorch = !!track?.getCapabilities?.().torch;
  let torchOn = false;

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const available = await window.BarcodeDetector.getSupportedFormats();
      const usable = FORMATS.filter((f) => available.includes(f));
      if (usable.length) detector = new window.BarcodeDetector({ formats: usable });
    } catch {
      detector = null; // fall through to our own decoder
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let running = true;
  let lastCode = null;
  let agreed = 0;
  let frames = 0;
  let vertical = false;
  let announced = false;

  /** Draw a source rectangle of the video into the work canvas and return it as luma. */
  function grabRect(sx, sy, sw, sh, w, h) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      // Rec. 601 luma, integer-only: barcodes are printed in black, so green dominates fine.
      gray[i] = (data[p] * 77 + data[p + 1] * 151 + data[p + 2] * 28) >> 8;
    }
    return gray;
  }

  /**
   * Sample the frame for a scanline sweep. The band has to be cropped ACROSS the bars and
   * kept whole ALONG them: a band of the frame's height only suits a barcode lying
   * horizontally, and cropping the same way for a sideways one cuts digits off the symbol
   * before it can be read.
   */
  function grabGray() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    if (!vertical) {
      const scale = Math.min(1, WORK_WIDTH / vw);
      const w = Math.max(64, Math.round(vw * scale));
      const h = Math.max(32, Math.round(vh * scale * BAND));
      const gray = grabRect(0, Math.round((vh * (1 - BAND)) / 2), vw, Math.round(vh * BAND), w, h);
      return { gray, width: w, height: h };
    }

    // Held sideways: take a tall middle column at full height, then transpose so the symbol
    // runs along rows and the same scanline sweep applies.
    const scale = Math.min(1, WORK_WIDTH / vh);
    const h = Math.max(64, Math.round(vh * scale));
    const w = Math.max(32, Math.round(vw * scale * BAND));
    const gray = grabRect(Math.round((vw * (1 - BAND)) / 2), 0, Math.round(vw * BAND), vh, w, h);
    const flipped = new Uint8Array(gray.length);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) flipped[x * h + y] = gray[y * w + x];
    return { gray: flipped, width: h, height: w };
  }

  function accept(code, format) {
    const normalized = toEAN13(code);
    if (!normalized) return;
    if (code === lastCode) {
      agreed += 1;
    } else {
      lastCode = code;
      agreed = 1;
    }
    if (agreed < AGREE) return;
    running = false;
    onHit?.({ code, format, ean13: normalized });
  }

  async function tick() {
    if (!running) return;
    frames += 1;
    try {
      if (detector) {
        const found = await detector.detect(video);
        for (const hit of found) {
          if (hit.rawValue) accept(hit.rawValue, hit.format);
          if (!running) return;
        }
      } else {
        // Alternate orientation between frames so each frame stays cheap.
        vertical = frames % 2 === 1;
        const frame = grabGray();
        if (frame) {
          const hit = decodeGray(frame.gray, frame.width, frame.height, { rows: 20 });
          if (hit) accept(hit.code, hit.format);
          if (!running) return;
        }
      }
      if (!announced && frames > 90) {
        announced = true;
        onStatus?.('Still looking. Fill the frame with the barcode, hold steady, and try more light.');
      }
    } catch {
      /* a dropped frame is normal; keep going */
    }
    if (running) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  return {
    engine: detector ? 'BarcodeDetector' : 'built-in',
    canTorch,
    async torch() {
      if (!canTorch) return false;
      torchOn = !torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        return torchOn;
      } catch {
        return false;
      }
    },
    stop() {
      running = false;
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}

import { QUALITY_TIERS } from '../../shared/assets.js';

/**
 * Conservative playback tier selection. Generation and playback are separate:
 * a low-tier client can still play a game authored with ultra source assets.
 */
export function detectQualityTier() {
  if (typeof navigator === 'undefined') return 'medium';
  const memory = Number(navigator.deviceMemory || 4);
  const cores = Number(navigator.hardwareConcurrency || 4);
  const small = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  if (small || memory <= 4 || cores <= 4) return 'low';
  if (memory >= 16 && cores >= 12) return 'ultra';
  if (memory >= 8 && cores >= 8) return 'high';
  return 'medium';
}

export function normalizeQualityTier(value) {
  return QUALITY_TIERS.includes(value) ? value : detectQualityTier();
}

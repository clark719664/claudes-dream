/**
 * Where to find Chromium.
 *
 * The cloud dev container ships one at a fixed path; a laptop has whatever
 * `npx playwright install chromium` put down. Hard-coding the container's path
 * meant every browser script failed anywhere else, so this prefers an explicit
 * override, then the container copy if it is actually there, and otherwise
 * lets Playwright use its own.
 */
import { existsSync } from 'node:fs';

const CONTAINER_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function chromiumOptions(extra = {}) {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) return { executablePath: explicit, ...extra };
  if (existsSync(CONTAINER_CHROMIUM)) return { executablePath: CONTAINER_CHROMIUM, ...extra };
  return extra; // Playwright's own download
}

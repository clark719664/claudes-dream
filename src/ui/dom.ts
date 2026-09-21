export const overlay = () => document.getElementById('overlay') as HTMLDivElement;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Render a screen into the overlay and wire it up. */
export function mount(html: string, wire?: (root: HTMLDivElement) => void, opaque = false): void {
  const root = overlay();
  root.classList.add('open');
  root.classList.toggle('opaque', opaque);
  root.scrollTop = 0;
  root.innerHTML = `<div class="screen">${html}</div>`;
  wire?.(root);
}

export function unmount(): void {
  const root = overlay();
  root.classList.remove('open', 'opaque');
  root.innerHTML = '';
}

export function on(root: ParentNode, selector: string, fn: (el: HTMLElement) => void): void {
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      fn(el);
    });
  });
}

let toastTimer: number | undefined;

export function toast(message: string, ms = 2200): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), ms);
}

/** Native share sheet where available, clipboard everywhere else. */
export async function share(text: string, title = 'Prism Break'): Promise<void> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  try {
    if (nav.share) {
      await nav.share({ title, text });
      return;
    }
  } catch {
    return; // the user dismissed the sheet
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Copy failed — long-press to select');
  }
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

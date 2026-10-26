import { html } from 'lit-html';

/**
 * Copy the issue ID for `btn` to clipboard and show transient "Copied" state.
 *
 * @param {HTMLButtonElement} btn
 * @param {string} id
 * @param {number} [duration_ms]
 */
async function copyIssueIdForButton(btn, id, duration_ms = 1200) {
  try {
    let copied = false;
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(String(id));
      copied = true;
    } else {
      // Fallback for non-secure contexts (HTTP, non-localhost)
      // where navigator.clipboard is undefined.
      const ta = document.createElement('textarea');
      ta.value = String(id);
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      // Append inside the nearest open <dialog> if any — showModal()
      // creates a top-layer that makes document.body inert.
      const container = btn.closest('dialog[open]') || document.body;
      container.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        copied = document.execCommand('copy');
      } finally {
        container.removeChild(ta);
      }
    }
    if (copied) {
      btn.textContent = 'Copied';
      const old_aria = btn.getAttribute('aria-label') || '';
      btn.setAttribute('aria-label', 'Copied');
      setTimeout(
        () => {
          btn.textContent = id;
          btn.setAttribute('aria-label', old_aria);
        },
        Math.max(80, duration_ms)
      );
    }
  } catch {
    // On failure, leave text as-is; no throw to avoid disruptive UX
  }
}

/**
 * @param {Event} ev
 */
function onIdButtonClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const btn = /** @type {HTMLButtonElement | null} */ (ev.currentTarget);
  const id = btn ? btn.getAttribute('data-copy-id') || '' : '';
  if (btn && id) {
    void copyIssueIdForButton(btn, id);
  }
}

/**
 * @param {KeyboardEvent} ev
 */
function onIdButtonKeydown(ev) {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    ev.stopPropagation();
    const btn = /** @type {HTMLButtonElement | null} */ (ev.currentTarget);
    const id = btn ? btn.getAttribute('data-copy-id') || '' : '';
    if (btn && id) {
      void copyIssueIdForButton(btn, id);
    }
  }
}

/**
 * Render a lit-html `<button>` for copying an issue ID without allocating or
 * re-parenting DOM elements across renders.
 *
 * @param {string} id
 * @returns {import('lit-html').TemplateResult<1>}
 */
export function renderIssueIdButton(id) {
  return html`<button
    type="button"
    class="mono id-copy"
    aria-live="polite"
    title="Copy issue ID"
    aria-label=${`Copy issue ID ${id}`}
    data-copy-id=${id}
    @click=${onIdButtonClick}
    @keydown=${onIdButtonKeydown}
  >
    ${id}
  </button>`;
}

/**
 * Create a reusable, copy-to-clipboard issue ID renderer.
 * Looks like the current inline ID (monospace `#123`) but acts as a button
 * that copies the full, prefixed ID (e.g., `UI-123`) when activated.
 * Shows transient "Copied" feedback and then restores the ID.
 *
 * @param {string} id - Full issue id including the prefix (e.g., "UI-123").
 * @param {{ class_name?: string, duration_ms?: number }} [opts]
 * @returns {HTMLButtonElement}
 */
export function createIssueIdRenderer(id, opts) {
  /** @type {number} */
  const duration =
    typeof opts?.duration_ms === 'number' ? opts.duration_ms : 1200;
  /** @type {HTMLButtonElement} */
  const btn = document.createElement('button');
  // Visual: match inline ID look; keep it neutral and text-like
  btn.className =
    (opts?.class_name ? opts.class_name + ' ' : '') + 'mono id-copy';
  btn.type = 'button';
  btn.setAttribute('aria-live', 'polite');
  btn.setAttribute('title', 'Copy issue ID');
  btn.setAttribute('aria-label', `Copy issue ID ${id}`);
  btn.textContent = id;

  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void copyIssueIdForButton(btn, id, duration);
  });
  btn.addEventListener('keydown', (ev) => {
    // Ensure keyboard activation works even in non-interactive test envs
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ev.stopPropagation();
      void copyIssueIdForButton(btn, id, duration);
    }
  });

  return btn;
}

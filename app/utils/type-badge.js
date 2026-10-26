import { html } from 'lit-html';
import { typeLabel } from './issue-type.js';

/** @type {Set<string>} */
const KNOWN_TYPES = new Set([
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision'
]);

/**
 * Render a lit-html badge for an issue type without allocating DOM elements.
 *
 * @param {string | undefined | null} issue_type
 * @returns {import('lit-html').TemplateResult<1>}
 */
export function renderTypeBadge(issue_type) {
  const t = (issue_type || '').toString().toLowerCase();
  const is_known = KNOWN_TYPES.has(t);
  const kind = is_known ? t : 'neutral';
  const label = is_known ? typeLabel(t) : '—';
  const aria = is_known ? `Issue type: ${label}` : 'Issue type: unknown';
  const title = is_known ? `Type: ${label}` : 'Type: unknown';
  return html`<span
    class=${`type-badge type-badge--${kind}`}
    role="img"
    aria-label=${aria}
    title=${title}
    >${label}</span
  >`;
}

/**
 * Create a compact, colored badge for an issue type.
 *
 * @param {string | undefined | null} issue_type - One of: bug, feature, task, epic, chore, decision
 * @returns {HTMLSpanElement}
 */
export function createTypeBadge(issue_type) {
  const el = document.createElement('span');
  el.className = 'type-badge';

  const t = (issue_type || '').toString().toLowerCase();
  const kind = KNOWN_TYPES.has(t) ? t : 'neutral';
  el.classList.add(`type-badge--${kind}`);
  el.setAttribute('role', 'img');
  const label = KNOWN_TYPES.has(t) ? typeLabel(t) : '—';
  el.setAttribute(
    'aria-label',
    KNOWN_TYPES.has(t) ? `Issue type: ${label}` : 'Issue type: unknown'
  );
  el.setAttribute(
    'title',
    KNOWN_TYPES.has(t) ? `Type: ${label}` : 'Type: unknown'
  );
  el.textContent = label;
  return el;
}

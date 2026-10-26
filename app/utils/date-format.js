/**
 * Date formatting helpers shared by the detail card and the list/epics tables.
 *
 * Timestamps reach the client as either numeric epoch-ms (top-level items pass
 * through `normalizeIssueList`) or ISO strings (some nested fields). `new
 * Date(value)` handles both identically.
 */

const ZERO_TIME_MAX_MS = Date.UTC(2, 0, 1) - 1;
const MAX_DATE_CACHE_SIZE = 20000;

/** @type {Intl.DateTimeFormat | null} */
let full_formatter = null;
/** @type {Intl.DateTimeFormat | null} */
let short_formatter = null;

/** @type {Map<number, string>} */
const full_date_cache = new Map();
/** @type {Map<number, string>} */
const short_date_cache = new Map();

/**
 * Get the shared full date-time formatter.
 *
 * @returns {Intl.DateTimeFormat}
 */
function getFullFormatter() {
  if (!full_formatter) {
    full_formatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  return full_formatter;
}

/**
 * Get the shared short date formatter.
 *
 * @returns {Intl.DateTimeFormat}
 */
function getShortFormatter() {
  if (!short_formatter) {
    short_formatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  return short_formatter;
}

/**
 * Coerce a date input to epoch-ms, or return NaN if missing/invalid/zero-time.
 *
 * @param {number | string | null | undefined} value
 * @returns {number}
 */
function toValidEpochMs(value) {
  if (value === null || value === undefined || value === '') {
    return NaN;
  }
  /** @type {number} */
  let ms;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      ms = new Date(value).getTime();
    }
  } else {
    return NaN;
  }
  if (!Number.isFinite(ms) || ms <= ZERO_TIME_MAX_MS) {
    return NaN;
  }
  return ms;
}

/**
 * Format a date value as a full local datetime (date + hour/minute).
 * Used by the detail view's Dates card and as the table cell tooltip.
 *
 * @param {number | string | null | undefined} value
 * @returns {string} Formatted local datetime, or '' when value is missing.
 */
export function formatDateValue(value) {
  const ms = toValidEpochMs(value);
  if (Number.isNaN(ms)) {
    return '';
  }
  const cached = full_date_cache.get(ms);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const out = getFullFormatter().format(ms);
    if (full_date_cache.size >= MAX_DATE_CACHE_SIZE) {
      full_date_cache.clear();
    }
    full_date_cache.set(ms, out);
    return out;
  } catch {
    return '';
  }
}

/**
 * Format a date value as a compact local date (no time) for table cells.
 * The full datetime is surfaced via the cell's `title` tooltip.
 *
 * @param {number | string | null | undefined} value
 * @returns {string} Formatted local date, or '' when value is missing.
 */
export function formatDateShort(value) {
  const ms = toValidEpochMs(value);
  if (Number.isNaN(ms)) {
    return '';
  }
  const cached = short_date_cache.get(ms);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const out = getShortFormatter().format(ms);
    if (short_date_cache.size >= MAX_DATE_CACHE_SIZE) {
      short_date_cache.clear();
    }
    short_date_cache.set(ms, out);
    return out;
  } catch {
    return '';
  }
}

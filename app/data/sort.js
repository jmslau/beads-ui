/**
 * Shared sort comparators for issues lists.
 * Centralizes sorting so views and stores stay consistent.
 */

/**
 * @import { Status } from '../protocol.js'
 */

/**
 * @typedef {{ id: string, title?: string, status?: Status, priority?: number, issue_type?: string, created_at?: number | string, updated_at?: number | string, closed_at?: number }} IssueLite
 */

/**
 * Compare by priority asc, then created_at asc, then id asc.
 *
 * @param {IssueLite} a
 * @param {IssueLite} b
 */
export function cmpPriorityThenCreated(a, b) {
  const pa = a.priority ?? 2;
  const pb = b.priority ?? 2;
  if (pa !== pb) {
    return pa - pb;
  }
  const ca = a.created_at ?? 0;
  const cb = b.created_at ?? 0;
  if (ca !== cb) {
    return ca < cb ? -1 : 1;
  }
  const ida = a.id;
  const idb = b.id;
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/**
 * Compare by closed_at desc, then id asc for stability.
 *
 * @param {IssueLite} a
 * @param {IssueLite} b
 */
export function cmpClosedDesc(a, b) {
  const ca = a.closed_at ?? 0;
  const cb = b.closed_at ?? 0;
  if (ca !== cb) {
    return ca < cb ? 1 : -1;
  }
  const ida = a?.id;
  const idb = b?.id;
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

const ZERO_TIME_MAX_MS = Date.UTC(2, 0, 1) - 1;

/**
 * Whether an epoch-ms instant is the `bd` zero-time sentinel (Go's
 * `0001-01-01`). `bd show --include-dependents` returns dependent timestamps
 * this way; treat it as "no value" so it never sorts as a real instant.
 *
 * @param {number} ms
 * @returns {boolean}
 */
export function isZeroTime(ms) {
  return Number.isFinite(ms) && ms <= ZERO_TIME_MAX_MS;
}

/**
 * Coerce a timestamp (epoch-ms number or ISO string) to epoch-ms. Missing,
 * unparseable, and zero-time sentinel values normalize to 0 so they sort as
 * "oldest/missing" and ties stay stable.
 *
 * @param {number | string | null | undefined} value
 * @returns {number}
 */
function toMs(value) {
  /** @type {number} */
  let ms;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
  } else {
    return 0;
  }
  if (!Number.isFinite(ms) || ms <= ZERO_TIME_MAX_MS) {
    return 0;
  }
  return ms;
}

/**
 * @typedef {{ text: string, num: number | null }} IdChunk
 */

/** @type {Map<string, IdChunk[]>} */
const ID_CHUNKS_CACHE = new Map();
const MAX_ID_CACHE_SIZE = 20000;

/**
 * Parse an issue ID into alternating text and numeric chunks, cached by ID.
 *
 * @param {string} id
 * @returns {IdChunk[]}
 */
function getParsedIdChunks(id) {
  let cached = ID_CHUNKS_CACHE.get(id);
  if (cached) {
    return cached;
  }
  const raw = id.match(/\d+|\D+/g) || [];
  /** @type {IdChunk[]} */
  const chunks = [];
  for (let i = 0; i < raw.length; i++) {
    const part = raw[i];
    const code = part.charCodeAt(0);
    const is_num = code >= 48 && code <= 57;
    chunks.push({
      text: part,
      num: is_num ? Number(part) : null
    });
  }
  if (ID_CHUNKS_CACHE.size >= MAX_ID_CACHE_SIZE) {
    ID_CHUNKS_CACHE.clear();
  }
  ID_CHUNKS_CACHE.set(id, chunks);
  return chunks;
}

/**
 * Natural (numeric-aware) comparison of two issue ids so that `UI-2` sorts
 * before `UI-10`. Splits each id into alternating text and number chunks and
 * compares chunk by chunk.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} -1, 0 or 1
 */
export function compareIdsNatural(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) {
    return 0;
  }
  const ax = getParsedIdChunks(sa);
  const bx = getParsedIdChunks(sb);
  const len = Math.min(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ac = ax[i];
    const bc = bx[i];
    if (ac.num !== null && bc.num !== null) {
      const diff = ac.num - bc.num;
      if (diff !== 0) {
        return diff < 0 ? -1 : 1;
      }
    } else if (ac.text !== bc.text) {
      return ac.text < bc.text ? -1 : 1;
    }
  }
  if (ax.length !== bx.length) {
    return ax.length < bx.length ? -1 : 1;
  }
  return 0;
}

/**
 * @typedef {'id' | 'created_at' | 'updated_at'} SortKey
 */

/**
 * A view's sort selection. `key === null` means no column sort is active, so
 * the view keeps its own default order.
 *
 * @typedef {{ key: SortKey | null, dir: 'asc' | 'desc' }} SortState
 */

/**
 * Advance the sort selection when a column header is clicked. Cycles a column
 * through ascending → descending → cleared, so the view's default order stays
 * reachable without a reload.
 *
 * @param {SortState} current
 * @param {SortKey} key
 * @returns {SortState}
 */
export function nextSortState(current, key) {
  if (current.key !== key) {
    return { key, dir: 'asc' };
  }
  if (current.dir === 'asc') {
    return { key, dir: 'desc' };
  }
  return { key: null, dir: 'asc' };
}

/**
 * Build a comparator for a user-selected sortable column.
 * Timestamp ties break by natural id ascending (independent of `dir`) so rows
 * stay stable across the frequent re-renders driven by live pushes.
 *
 * @param {SortKey} key
 * @param {'asc' | 'desc'} dir
 * @returns {(a: IssueLite, b: IssueLite) => number}
 */
export function compareByKey(key, dir) {
  const factor = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    if (key === 'id') {
      return factor * compareIdsNatural(String(a.id), String(b.id));
    }
    const av = toMs(a[key]);
    const bv = toMs(b[key]);
    if (av !== bv) {
      return factor * (av < bv ? -1 : 1);
    }
    return compareIdsNatural(String(a.id), String(b.id));
  };
}

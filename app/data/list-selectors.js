/**
 * List selectors utility: compose subscription membership with issues entities
 * and apply view-specific sorting. Provides a lightweight `subscribe` that
 * triggers once per issues envelope to let views re-render.
 */
/**
 * @import { Status } from '../protocol.js'
 */
/**
 * @typedef {{ id: string, title?: string, status?: Status, priority?: number, issue_type?: string, created_at?: number, updated_at?: number, closed_at?: number }} IssueLite
 */
import { cmpClosedDesc, cmpPriorityThenCreated } from './sort.js';

/**
 * Factory for list selectors.
 *
 * Source of truth is per-subscription stores providing snapshots for a given
 * client id. Central issues store fallback has been removed.
 *
 * @param {{ snapshotFor?: (client_id: string) => IssueLite[], readSnapshotFor?: (client_id: string) => readonly IssueLite[], subscribe?: (fn: () => void) => () => void, subscribeKeys?: (client_ids: string | string[], fn: () => void) => () => void }} [issue_stores]
 */
export function createListSelectors(issue_stores = undefined) {
  // Sorting comparators are centralized in app/data/sort.js

  /**
   * Read items for a subscription id. When `readSnapshotFor` is available, the
   * store already maintains `cmpPriorityThenCreated` order so we only copy the
   * array without re-sorting.
   *
   * @param {string} client_id
   * @returns {IssueLite[]}
   */
  function selectIssuesFor(client_id) {
    if (!issue_stores) {
      return [];
    }
    if (typeof issue_stores.readSnapshotFor === 'function') {
      return issue_stores.readSnapshotFor(client_id).slice();
    }
    if (typeof issue_stores.snapshotFor !== 'function') {
      return [];
    }
    return issue_stores
      .snapshotFor(client_id)
      .slice()
      .sort(cmpPriorityThenCreated);
  }

  /**
   * Get entities for a Board column with column-specific sort.
   *
   * @param {string} client_id
   * @param {'ready'|'blocked'|'in_progress'|'closed'} mode
   * @returns {IssueLite[]}
   */
  function selectBoardColumn(client_id, mode) {
    if (!issue_stores) {
      return [];
    }
    const has_read_snap = typeof issue_stores.readSnapshotFor === 'function';
    const arr = has_read_snap
      ? /** @type { { readSnapshotFor: (id: string) => readonly IssueLite[] } } */ (
          issue_stores
        )
          .readSnapshotFor(client_id)
          .slice()
      : issue_stores.snapshotFor
        ? issue_stores.snapshotFor(client_id).slice()
        : [];
    if (mode === 'closed') {
      arr.sort(cmpClosedDesc);
    } else if (!has_read_snap) {
      // ready/blocked/in_progress share the same sort (already sorted when readSnapshotFor is used)
      arr.sort(cmpPriorityThenCreated);
    }
    return arr;
  }

  /**
   * Get entities for a Board column fed by more than one subscription.
   *
   * The Blocked lane is the union of `bd blocked` (dependency-blocked issues,
   * whose own status is `open`) and `bd list --status blocked` (issues whose
   * stored status is `blocked`). The two sources overlap, so entries are
   * deduplicated by id — first occurrence wins — before sorting.
   *
   * @param {string[]} client_ids
   * @param {'ready'|'blocked'|'in_progress'|'closed'} mode
   * @returns {IssueLite[]}
   */
  function selectBoardColumnUnion(client_ids, mode) {
    if (
      !issue_stores ||
      (typeof issue_stores.snapshotFor !== 'function' &&
        typeof issue_stores.readSnapshotFor !== 'function')
    ) {
      return [];
    }
    /** @type {IssueLite[]} */
    const merged = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const client_id of Array.isArray(client_ids) ? client_ids : []) {
      const source =
        typeof issue_stores.readSnapshotFor === 'function'
          ? issue_stores.readSnapshotFor(client_id)
          : issue_stores.snapshotFor
            ? issue_stores.snapshotFor(client_id)
            : [];
      for (const it of source || []) {
        const id = String(it?.id ?? '');
        if (id.length === 0 || seen.has(id)) {
          continue;
        }
        seen.add(id);
        merged.push(it);
      }
    }
    if (mode === 'closed') {
      merged.sort(cmpClosedDesc);
    } else {
      // ready/blocked/in_progress share the same sort
      merged.sort(cmpPriorityThenCreated);
    }
    return merged;
  }

  /**
   * Get children for an epic subscribed as client id `epic:${id}`.
   * Sorted as Issues List (priority asc → created asc).
   *
   * @param {string} epic_id
   * @returns {IssueLite[]}
   */
  function selectEpicChildren(epic_id) {
    if (
      !issue_stores ||
      (typeof issue_stores.snapshotFor !== 'function' &&
        typeof issue_stores.readSnapshotFor !== 'function')
    ) {
      return [];
    }
    // Epic detail subscription uses client id `detail:<id>` and contains the
    // epic entity with a `dependents` array. Render children from that list.
    const arr = /** @type {any[]} */ (
      typeof issue_stores.readSnapshotFor === 'function'
        ? issue_stores.readSnapshotFor(`detail:${epic_id}`)
        : issue_stores.snapshotFor
          ? issue_stores.snapshotFor(`detail:${epic_id}`)
          : []
    );
    const epic = arr.find((it) => String(it?.id || '') === String(epic_id));
    const dependents = Array.isArray(epic?.dependents) ? epic.dependents : [];
    return /** @type {IssueLite[]} */ (
      dependents.slice().sort(cmpPriorityThenCreated)
    );
  }

  /**
   * Subscribe for re-render; triggers once per issues envelope.
   *
   * @param {() => void} fn
   * @param {string | string[]} [client_ids]
   * @returns {() => void}
   */
  function subscribe(fn, client_ids = undefined) {
    if (
      client_ids &&
      issue_stores &&
      typeof issue_stores.subscribeKeys === 'function'
    ) {
      return issue_stores.subscribeKeys(client_ids, fn);
    }
    if (issue_stores && typeof issue_stores.subscribe === 'function') {
      return issue_stores.subscribe(fn);
    }
    return () => {};
  }

  return {
    selectIssuesFor,
    selectBoardColumn,
    selectBoardColumnUnion,
    selectEpicChildren,
    subscribe
  };
}

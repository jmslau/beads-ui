import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import {
  cmpPriorityThenCreated,
  compareByKey,
  nextSortState
} from '../data/sort.js';
import { createColumnResizer } from './column-resize.js';
import { ISSUE_ROW_COLUMNS, createIssueRowRenderer } from './issue-row.js';

/**
 * @import { SortState } from '../data/sort.js'
 * @import { Status } from '../protocol.js'
 */

/**
 * @typedef {{ id: string, title?: string, status?: Status, priority?: number, issue_type?: string, assignee?: string, parent?: string, created_at?: number, updated_at?: number }} IssueLite
 */

/**
 * Lists backing the child issue search. Subscribed only while a search term is
 * active. A single `--all` list covers open and closed children in one query,
 * so the epics search shares the exact "everything" set the Issues search uses
 * (no separate open + capped-closed subscriptions to keep in sync).
 *
 * @type {{ client_id: string, spec: { type: string } }[]}
 */
const SEARCH_LISTS = [
  {
    client_id: 'epics:search-all',
    spec: { type: 'all-issues-including-closed' }
  }
];

/**
 * Epics view (push-only):
 * - Derives epic groups from the local issues store (no RPC reads).
 * - Subscribes to `tab:epics` for top-level membership.
 * - On expand, subscribes to `detail:{id}` (issue-detail) for the epic.
 * - Renders children from the epic detail's `dependents` list.
 * - Provides inline edits via mutations; UI re-renders on push.
 * - Search matches epics by id/title and their child issues by id/title.
 *
 * @param {HTMLElement} mount_element
 * @param {{ updateIssue: (input: any) => Promise<any> }} data
 * @param {(id: string) => void} goto_issue - Navigate to issue detail.
 * @param {{ subscribeList: (client_id: string, spec: { type: string, params?: Record<string, string|number|boolean> }) => Promise<() => Promise<void>>, selectors: { getIds: (client_id: string) => string[], count?: (client_id: string) => number } }} [subscriptions]
 * @param {{ snapshotFor?: (client_id: string) => any[], subscribe?: (fn: () => void) => () => void }} [issue_stores]
 */
export function createEpicsView(
  mount_element,
  data,
  goto_issue,
  subscriptions = undefined,
  issue_stores = undefined
) {
  /** @type {any[]} */
  let groups = [];
  /** @type {string} */
  let search_text = loadSearch();
  /** @type {Set<string>} */
  const expanded = new Set();
  /** @type {Set<string>} */
  const loading = new Set();
  /** @type {Map<string, () => Promise<void>>} */
  const epic_unsubs = new Map();
  // Two independent sort selections. The epic-level state orders the epics
  // themselves (the top header, mirroring the Issues tab); the child state is
  // shared across every expanded group so a child header click sorts all
  // groups' children the same way (and the arrow shows in each).
  /** @type {SortState} */
  let epic_sort_state = { key: null, dir: 'asc' };
  /** @type {SortState} */
  let child_sort_state = { key: null, dir: 'asc' };
  /** @type {Map<string, () => Promise<void>>} */
  const search_unsubs = new Map();
  let search_loading = false;
  // Centralized selection helpers
  const selectors = issue_stores ? createListSelectors(issue_stores) : null;

  /**
   * Cycle the epic-level column header through ascending → descending → cleared.
   *
   * @param {string} key
   */
  const onSortEpics = (key) => {
    epic_sort_state = nextSortState(epic_sort_state, /** @type {any} */ (key));
    doRender();
  };

  /**
   * Cycle a child column header through ascending → descending → cleared.
   *
   * @param {string} key
   */
  const onSortChild = (key) => {
    child_sort_state = nextSortState(
      child_sort_state,
      /** @type {any} */ (key)
    );
    doRender();
  };

  /**
   * Whether an epic renders expanded. During search every visible epic is shown
   * open (its matching children are always displayed).
   *
   * @param {string} id
   */
  function isEpicOpen(id) {
    return search_text.length > 0 || expanded.has(String(id));
  }

  /**
   * Compact progress meter shown after an epic's title, in place of a tenth
   * column so epic rows keep the exact Issues column set.
   *
   * @param {any} it - Epic row data carrying total/closed child counts.
   */
  function epicProgress(it) {
    const total = Math.max(0, Number(it.total_children || 0));
    const closed = Number(it.closed_children || 0);
    return html`<span class="epic-progress">
      <progress value=${closed} max=${Math.max(1, total)}></progress>
      <span class="muted mono">${closed}/${total}</span>
    </span>`;
  }
  // Live re-render on pushes: recompute groups when stores change
  if (selectors) {
    selectors.subscribe(() => {
      const had_none = groups.length === 0;
      groups = buildGroupsFromSnapshot();
      doRender();
      // Auto-expand first epic when transitioning from empty to non-empty
      if (had_none && groups.length > 0) {
        void expandFirst();
      }
    });
  }

  // Shared row renderer used for children rows
  const renderRow = createIssueRowRenderer({
    navigate: (id) => goto_issue(id),
    onUpdate: updateInline,
    requestRender: doRender,
    getSelectedId: () => null,
    row_class: 'epic-row'
  });

  // Row renderer for the epics themselves: the same columns as the Issues tab,
  // plus a disclosure caret in the ID cell and the child-progress meter after
  // the title. Clicking the row toggles expansion instead of navigating.
  const renderEpicRow = createIssueRowRenderer({
    navigate: (id) => goto_issue(id),
    onUpdate: updateInline,
    requestRender: doRender,
    getSelectedId: () => null,
    row_class: 'epic-parent-row epic-header',
    onRowClick: (id) => void toggle(id),
    getAriaExpanded: (it) => isEpicOpen(String(it.id)),
    leadingControl: (it) =>
      html`<span class="epic-caret" aria-hidden="true"
        >${isEpicOpen(String(it.id)) ? '▾' : '▸'}</span
      >`,
    titleSuffix: (it) => epicProgress(it)
  });

  // Resizable columns shared by every epic table, persisted per view
  const column_resizer = createColumnResizer({
    mount_element,
    storage_key: 'beads-ui.columns.epics',
    columns: ISSUE_ROW_COLUMNS,
    requestRender: doRender
  });

  function doRender() {
    render(template(), mount_element);
  }

  /**
   * Read the persisted search term.
   */
  function loadSearch() {
    try {
      return window.localStorage.getItem('beads-ui.epics.search') || '';
    } catch {
      return '';
    }
  }

  /**
   * Event: search input.
   *
   * @param {Event} ev
   */
  function onSearchInput(ev) {
    const input = /** @type {HTMLInputElement} */ (ev.currentTarget);
    search_text = input.value;
    try {
      window.localStorage.setItem('beads-ui.epics.search', search_text);
    } catch {
      // Storage unavailable; the term stays in memory for this session.
    }
    doRender();
    void syncSearchSubscriptions();
  }

  /**
   * Subscribe to the issue lists backing child search while a term is active;
   * release them when the search is cleared.
   */
  async function syncSearchSubscriptions() {
    const wanted = search_text.length > 0;
    if (!subscriptions || typeof subscriptions.subscribeList !== 'function') {
      return;
    }
    if (wanted && search_unsubs.size === 0 && !search_loading) {
      search_loading = true;
      doRender();
      for (const list of SEARCH_LISTS) {
        try {
          // Register the store first to avoid dropping the initial snapshot
          if (issue_stores && /** @type {any} */ (issue_stores).register) {
            /** @type {any} */ (issue_stores).register(
              list.client_id,
              list.spec
            );
          }
          const unsub = await subscriptions.subscribeList(
            list.client_id,
            list.spec
          );
          search_unsubs.set(list.client_id, unsub);
        } catch {
          // ignore subscription failures; search falls back to epic matches
        }
      }
      search_loading = false;
      doRender();
      if (!search_text) {
        // Search was cleared while subscribing; release right away
        await syncSearchSubscriptions();
      }
      return;
    }
    if (!wanted && search_unsubs.size > 0) {
      const entries = Array.from(search_unsubs.entries());
      search_unsubs.clear();
      for (const [client_id, unsub] of entries) {
        try {
          await unsub();
        } catch {
          // ignore
        }
        try {
          if (issue_stores && /** @type {any} */ (issue_stores).unregister) {
            /** @type {any} */ (issue_stores).unregister(client_id);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Child issues of every epic, keyed by parent id, from the search lists.
   *
   * @returns {Map<string, IssueLite[]>}
   */
  function childrenByParent() {
    /** @type {Map<string, IssueLite[]>} */
    const by_parent = new Map();
    if (!issue_stores || typeof issue_stores.snapshotFor !== 'function') {
      return by_parent;
    }
    /** @type {Set<string>} */
    const seen = new Set();
    for (const list of SEARCH_LISTS) {
      const items = /** @type {IssueLite[]} */ (
        issue_stores.snapshotFor(list.client_id) || []
      );
      for (const it of items) {
        const parent = String(it.parent || '');
        const id = String(it.id || '');
        if (!parent || seen.has(id)) {
          continue;
        }
        seen.add(id);
        const bucket = by_parent.get(parent);
        if (bucket) {
          bucket.push(it);
        } else {
          by_parent.set(parent, [it]);
        }
      }
    }
    for (const bucket of by_parent.values()) {
      bucket.sort(cmpPriorityThenCreated);
    }
    return by_parent;
  }

  /**
   * Whether an id or title contains the needle.
   *
   * @param {{ id?: string, title?: string }} item
   * @param {string} needle
   */
  function matchesNeedle(item, needle) {
    const id = String(item.id || '').toLowerCase();
    const title = String(item.title || '').toLowerCase();
    return id.includes(needle) || title.includes(needle);
  }

  /**
   * Epic groups to render. Without a search term every group renders its own
   * children on expand. With one, a group is kept when the epic matches (all
   * children shown) or when its children match (only those shown).
   *
   * @returns {{ group: any, children: IssueLite[] | null }[]}
   */
  function visibleEntries() {
    if (!search_text) {
      return groups.map((g) => ({ group: g, children: null }));
    }
    const needle = search_text.toLowerCase();
    const by_parent = childrenByParent();
    /** @type {{ group: any, children: IssueLite[] | null }[]} */
    const entries = [];
    for (const g of groups) {
      const epic = g.epic || {};
      const children = by_parent.get(String(epic.id || '')) || [];
      if (matchesNeedle(epic, needle)) {
        entries.push({ group: g, children });
        continue;
      }
      const hits = children.filter((it) => matchesNeedle(it, needle));
      if (hits.length > 0) {
        entries.push({ group: g, children: hits });
      }
    }
    return entries;
  }

  /**
   * Groups matching the current search term.
   */
  function visibleGroups() {
    return visibleEntries().map((entry) => entry.group);
  }

  /**
   * Message shown when nothing is rendered.
   */
  function emptyMessage() {
    if (groups.length === 0) {
      return 'No epics found.';
    }
    if (search_loading) {
      return 'Searching…';
    }
    return 'No matching epics or issues.';
  }

  /**
   * Apply the epic-level column sort to visible entries. With no epic sort
   * selected the groups keep the store's default order (priority asc → created
   * asc).
   *
   * @param {{ group: any, children: IssueLite[] | null }[]} entries
   */
  function sortEntries(entries) {
    if (!epic_sort_state.key) {
      return entries;
    }
    const cmp = compareByKey(epic_sort_state.key, epic_sort_state.dir);
    return entries
      .slice()
      .sort((a, b) => cmp(a.group.epic || {}, b.group.epic || {}));
  }

  function template() {
    const visible = sortEntries(visibleEntries());
    return html`
      <div class="panel__header">
        <input
          type="search"
          placeholder="Search…"
          aria-label="Search epics and issues"
          @input=${onSearchInput}
          .value=${search_text}
        />
      </div>
      <div class="panel__body" id="epics-list">
        ${visible.length === 0
          ? html`<div class="muted" style="padding:10px 12px;">
              ${emptyMessage()}
            </div>`
          : html`<div class="epics-block">
              <table class="table epics-head">
                ${column_resizer.colgroup()}
                <thead>
                  <tr>
                    ${column_resizer.headerCells({
                      state: epic_sort_state,
                      onSort: onSortEpics
                    })}
                  </tr>
                </thead>
              </table>
              ${visible.map((entry) =>
                groupTemplate(entry.group, entry.children)
              )}
            </div>`}
      </div>
    `;
  }

  /**
   * @param {any} g
   * @param {IssueLite[] | null} [search_children] - Rows to show while
   * searching; `null` renders the epic's own children on expand.
   */
  function groupTemplate(g, search_children = null) {
    const epic = g.epic || {};
    const id = String(epic.id || '');
    // Search hits are always shown, expanded or not
    const is_open = search_children !== null || expanded.has(id);
    // Compose children (search hits or the epic's own children). A selected
    // child column sort overrides the default (priority asc → created asc)
    // order.
    const base_list =
      search_children !== null
        ? search_children
        : selectors
          ? selectors.selectEpicChildren(id)
          : [];
    const list = child_sort_state.key
      ? base_list
          .slice()
          .sort(compareByKey(child_sort_state.key, child_sort_state.dir))
      : base_list;
    const is_loading = search_children === null && loading.has(id);
    // The epic itself, rendered with the shared row renderer. Attach the group
    // counters so the title-cell progress meter can read them.
    const epic_row = {
      ...epic,
      total_children: g.total_children,
      closed_children: g.closed_children
    };
    return html`
      <div class="epic-group" data-epic-id=${id}>
        <table class="table epic-parent-table">
          ${column_resizer.colgroup()}
          <tbody>
            ${renderEpicRow(epic_row)}
          </tbody>
        </table>
        ${is_open
          ? html`<div class="epic-children">
              ${is_loading
                ? html`<div class="muted">Loading…</div>`
                : list.length === 0
                  ? html`<div class="muted">No issues found</div>`
                  : html`<table class="table">
                      ${column_resizer.colgroup()}
                      <thead>
                        <tr>
                          ${column_resizer.headerCells({
                            state: child_sort_state,
                            onSort: onSortChild
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        ${list.map((it) => renderRow(it))}
                      </tbody>
                    </table>`}
            </div>`
          : null}
      </div>
    `;
  }

  /**
   * @param {string} id
   * @param {{ [k: string]: any }} patch
   */
  async function updateInline(id, patch) {
    try {
      await data.updateIssue({ id, ...patch });
      // Re-render; view will update on subsequent push
      doRender();
    } catch {
      // swallow; UI remains
    }
  }

  /**
   * @param {string} epic_id
   */
  async function toggle(epic_id) {
    if (!expanded.has(epic_id)) {
      expanded.add(epic_id);
      loading.add(epic_id);
      doRender();
      // Subscribe to epic detail; children are rendered from `dependents`
      if (subscriptions && typeof subscriptions.subscribeList === 'function') {
        try {
          // Register store first to avoid dropping the initial snapshot
          try {
            if (issue_stores && /** @type {any} */ (issue_stores).register) {
              /** @type {any} */ (issue_stores).register(`detail:${epic_id}`, {
                type: 'issue-detail',
                params: { id: epic_id }
              });
            }
          } catch {
            // ignore
          }
          const u = await subscriptions.subscribeList(`detail:${epic_id}`, {
            type: 'issue-detail',
            params: { id: epic_id }
          });
          epic_unsubs.set(epic_id, u);
        } catch {
          // ignore subscription failures
        }
      }
      // Mark as not loading after subscribe attempt; membership will stream in
      loading.delete(epic_id);
    } else {
      expanded.delete(epic_id);
      // Unsubscribe when collapsing
      if (epic_unsubs.has(epic_id)) {
        try {
          const u = epic_unsubs.get(epic_id);
          if (u) {
            await u();
          }
        } catch {
          // ignore
        }
        epic_unsubs.delete(epic_id);
        try {
          if (issue_stores && /** @type {any} */ (issue_stores).unregister) {
            /** @type {any} */ (issue_stores).unregister(`detail:${epic_id}`);
          }
        } catch {
          // ignore
        }
      }
    }
    doRender();
  }

  /** Build groups from the current `tab:epics` snapshot. */
  function buildGroupsFromSnapshot() {
    /** @type {IssueLite[]} */
    const epic_entities =
      issue_stores && issue_stores.snapshotFor
        ? /** @type {IssueLite[]} */ (
            issue_stores.snapshotFor('tab:epics') || []
          )
        : [];
    const next_groups = [];
    for (const epic of epic_entities) {
      const dependents = Array.isArray(/** @type {any} */ (epic).dependents)
        ? /** @type {any[]} */ (/** @type {any} */ (epic).dependents)
        : [];
      // Prefer explicit counters when provided by server; otherwise derive
      const has_total = Number.isFinite(
        /** @type {any} */ (epic).total_children
      );
      const has_closed = Number.isFinite(
        /** @type {any} */ (epic).closed_children
      );
      const total = has_total
        ? Number(/** @type {any} */ (epic).total_children) || 0
        : dependents.length;
      let closed = has_closed
        ? Number(/** @type {any} */ (epic).closed_children) || 0
        : 0;
      if (!has_closed) {
        for (const d of dependents) {
          if (String(d.status || '') === 'closed') {
            closed++;
          }
        }
      }
      next_groups.push({
        epic,
        total_children: total,
        closed_children: closed
      });
    }
    return next_groups;
  }

  /** Expand the first epic on screen. Search hits are shown regardless. */
  async function expandFirst() {
    if (search_text) {
      return;
    }
    try {
      const visible = visibleGroups();
      if (visible.length === 0) {
        return;
      }
      const first_id = String(visible[0].epic?.id || '');
      if (first_id && !expanded.has(first_id)) {
        // This will render and load children lazily
        await toggle(first_id);
      }
    } catch {
      // ignore auto-expand failures
    }
  }

  return {
    async load() {
      groups = buildGroupsFromSnapshot();
      doRender();
      await syncSearchSubscriptions();
      await expandFirst();
    }
  };
}

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';
import { createWsClient } from './ws.js';

/**
 * Click the scope radio with the given label in the status dropdown.
 *
 * @param {string} label - Visible label of the radio.
 */
function selectScope(label) {
  const dropdown = document.querySelectorAll('.filter-dropdown')[0];
  const trigger = /** @type {HTMLButtonElement} */ (
    dropdown.querySelector('.filter-dropdown__trigger')
  );
  trigger.click();
  const option = Array.from(
    dropdown.querySelectorAll('.filter-dropdown__option--scope')
  ).find((opt) => (opt.textContent || '').trim() === label);
  const radio = /** @type {HTMLInputElement} */ (
    option?.querySelector('input[type="radio"]')
  );
  radio.click();
}

/**
 * Click the status checkbox with the given label in the status dropdown.
 *
 * @param {string} label - Visible label of the checkbox.
 */
function toggleStatus(label) {
  const dropdown = document.querySelectorAll('.filter-dropdown')[0];
  const trigger = /** @type {HTMLButtonElement} */ (
    dropdown.querySelector('.filter-dropdown__trigger')
  );
  trigger.click();
  const option = Array.from(
    dropdown.querySelectorAll('.filter-dropdown__option--status')
  ).find((opt) => (opt.textContent || '').trim() === label);
  const checkbox = /** @type {HTMLInputElement} */ (
    option?.querySelector('input[type="checkbox"]')
  );
  checkbox.click();
}

/**
 * Type into the issues-list search box and fire the input event.
 *
 * @param {string} value - Text to enter (empty clears the search).
 */
function typeSearch(value) {
  const input = /** @type {HTMLInputElement} */ (
    document
      .querySelector('#list-root, .panel')
      ?.querySelector('input[type="search"]') ||
      document.querySelector('input[type="search"]')
  );
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The spec type of the most recent `tab:issues` subscription request.
 *
 * @returns {string}
 */
function lastIssuesSpecType() {
  const subs = calls.filter(
    (c) => c.type === 'subscribe-list' && c.payload?.id === 'tab:issues'
  );
  return subs.length > 0 ? String(subs[subs.length - 1].payload.type) : '';
}

/**
 * Ids of the currently rendered rows.
 *
 * @returns {string[]}
 */
function rowIds() {
  return Array.from(document.querySelectorAll('#list-root tr.issue-row')).map(
    (el) => el.getAttribute('data-issue-id') || ''
  );
}

/**
 * Let queued microtasks (subscriptions, store notifications) settle.
 */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

const ALL_ISSUES = [
  {
    id: 'A-1',
    title: 'open one',
    status: 'open',
    created_at: 10,
    updated_at: 10
  },
  {
    id: 'B-1',
    title: 'blocked one',
    status: 'blocked',
    created_at: 20,
    updated_at: 20
  },
  {
    id: 'C-1',
    title: 'in progress one',
    status: 'in_progress',
    created_at: 30,
    updated_at: 30
  }
];

// Mock WS client to drive push envelopes and record RPCs
/** @type {{ type: string, payload: any }[]} */
const calls = [];
vi.mock('./ws.js', () => {
  /** @type {Record<string, (p: any) => void>} */
  const handlers = {};
  const singleton = {
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    async send(type, payload) {
      calls.push({ type, payload });
      return null;
    },
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {(p: any) => void} handler
     */
    on(type, handler) {
      handlers[type] = handler;
      return () => {
        delete handlers[type];
      };
    },
    /**
     * Test helper: trigger a server event.
     *
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    _trigger(type, payload) {
      if (handlers[type]) {
        handlers[type](payload);
      }
    },
    onConnection() {
      return () => {};
    },
    close() {},
    getState() {
      return 'open';
    }
  };
  return { createWsClient: () => singleton };
});

describe('issues view — status filter model', () => {
  /** @type {any} */
  let client;

  beforeEach(async () => {
    calls.length = 0;
    window.localStorage.clear();
    client = /** @type {any} */ (createWsClient());
    window.location.hash = '#/issues';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await settle();
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 1,
      issues: ALL_ISSUES
    });
    await settle();
  });

  test('leaving the Ready scope for a status narrows to that status', async () => {
    selectScope('Ready only');
    await settle();

    selectScope('By status');
    await settle();
    toggleStatus('Open');
    await settle();

    expect(lastIssuesSpecType()).toBe('all-issues');
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: ALL_ISSUES
    });
    await settle();
    expect(rowIds()).toEqual(['A-1']);
  });

  test('selecting Ready after a status subscribes to ready issues', async () => {
    toggleStatus('Open');
    await settle();

    selectScope('Ready only');
    await settle();

    expect(lastIssuesSpecType()).toBe('ready-issues');
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: [ALL_ISSUES[2]]
    });
    await settle();
    expect(rowIds()).toEqual(['C-1']);
  });

  test('two statuses subscribe to all issues and filter client-side', async () => {
    toggleStatus('Open');
    await settle();
    toggleStatus('Blocked');
    await settle();

    expect(lastIssuesSpecType()).toBe('all-issues');
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: ALL_ISSUES
    });
    await settle();
    expect(rowIds()).toEqual(['A-1', 'B-1']);
  });

  test('a single stored status keeps its dedicated subscription', async () => {
    toggleStatus('In progress');
    await settle();

    expect(lastIssuesSpecType()).toBe('in-progress-issues');
  });

  test('searching with no status filter widens to include closed issues', async () => {
    // Regression: a search from the default (open-only) list could never match
    // a closed issue, because the `all-issues` subscription excludes closed.
    typeSearch('nmxr6');
    await settle();

    expect(lastIssuesSpecType()).toBe('all-issues-including-closed');

    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: [
        {
          id: 'ENT-nmxr6.1',
          title: 'Callback-aware outbound opener',
          status: 'closed',
          created_at: 40,
          updated_at: 40,
          closed_at: 50
        },
        {
          id: 'OTHER-1',
          title: 'unrelated open work',
          status: 'open',
          created_at: 41,
          updated_at: 41
        }
      ]
    });
    await settle();

    // The closed issue is found; the non-matching open row is filtered out.
    expect(rowIds()).toEqual(['ENT-nmxr6.1']);
  });

  test('a Closed-inclusive status union widens to include closed issues', async () => {
    // Regression: selecting Closed alongside another status resolved to the
    // open-only `all-issues` list, so the Closed rows never arrived.
    toggleStatus('Open');
    await settle();
    toggleStatus('Closed');
    await settle();

    expect(lastIssuesSpecType()).toBe('all-issues-including-closed');

    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: [
        {
          id: 'OPEN-1',
          title: 'open one',
          status: 'open',
          created_at: 10,
          updated_at: 10
        },
        {
          id: 'DONE-1',
          title: 'closed one',
          status: 'closed',
          created_at: 20,
          updated_at: 20,
          closed_at: 25
        },
        {
          id: 'PROG-1',
          title: 'in progress one',
          status: 'in_progress',
          created_at: 30,
          updated_at: 30
        }
      ]
    });
    await settle();

    // Open + Closed selected: both show, the in-progress row is filtered out.
    expect(rowIds().sort()).toEqual(['DONE-1', 'OPEN-1']);
  });

  test('searching within the lone Closed filter keeps the closed-issues list', async () => {
    // Closed-only resolves to the dedicated (now uncapped) `closed-issues`
    // list, so search over closed still works. Guards the block ordering:
    // the single-status early return must win over the search widening.
    toggleStatus('Closed');
    await settle();
    typeSearch('alpha');
    await settle();

    expect(lastIssuesSpecType()).toBe('closed-issues');

    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: [
        {
          id: 'CL-1',
          title: 'alpha done',
          status: 'closed',
          created_at: 20,
          updated_at: 20,
          closed_at: 25
        },
        {
          id: 'CL-2',
          title: 'beta done',
          status: 'closed',
          created_at: 21,
          updated_at: 21,
          closed_at: 26
        }
      ]
    });
    await settle();

    expect(rowIds()).toEqual(['CL-1']);
  });

  test('in progress plus another status widens to all issues', async () => {
    toggleStatus('In progress');
    await settle();
    toggleStatus('Blocked');
    await settle();

    expect(lastIssuesSpecType()).toBe('all-issues');
  });

  test('fast toggles settle on the subscription of the final selection', async () => {
    // No awaits in between: both toggles land before any subscription resolves.
    toggleStatus('In progress');
    selectScope('Ready only');
    await settle();

    expect(lastIssuesSpecType()).toBe('ready-issues');

    // Newer revision for the ready list arrives first…
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 3,
      issues: [ALL_ISSUES[0], ALL_ISSUES[2]]
    });
    await settle();
    // …then a stale snapshot of the abandoned list, which must not win.
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: [ALL_ISSUES[2]]
    });
    await settle();

    expect(rowIds()).toEqual(['A-1', 'C-1']);
  });

  test('fast toggles back out of the Ready scope keep the last selection', async () => {
    selectScope('Ready only');
    selectScope('By status');
    toggleStatus('In progress');
    await settle();

    expect(lastIssuesSpecType()).toBe('in-progress-issues');

    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 3,
      issues: [ALL_ISSUES[2]]
    });
    await settle();
    client._trigger('snapshot', {
      type: 'snapshot',
      id: 'tab:issues',
      revision: 2,
      issues: ALL_ISSUES
    });
    await settle();

    expect(rowIds()).toEqual(['C-1']);
  });
});

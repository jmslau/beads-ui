/**
 * @import { SettableStatus } from '../protocol.js'
 */
import { html, nothing } from 'lit-html';
import { formatDateShort, formatDateValue } from '../utils/date-format.js';
import { renderIssueIdButton } from '../utils/issue-id-renderer.js';
import { ISSUE_TYPES, typeLabel } from '../utils/issue-type.js';
import { emojiForPriority } from '../utils/priority-badge.js';
import { priority_levels } from '../utils/priority.js';
import {
  isSettableStatus,
  statusLabel,
  statusOptions
} from '../utils/status.js';
import { columnSpacerCell } from './column-resize.js';

/**
 * @import { ColumnSpec } from './column-resize.js'
 */

/**
 * @typedef {{ id: string, title?: string, status?: string, priority?: number, issue_type?: string, assignee?: string, created_at?: number|string, updated_at?: number|string, dependency_count?: number, dependent_count?: number }} IssueRowData
 */

/**
 * Columns rendered by `createIssueRowRenderer`, in cell order. Used by the
 * list and epics views to render matching, resizable headers.
 *
 * @type {ColumnSpec[]}
 */
export const ISSUE_ROW_COLUMNS = [
  { key: 'id', label: 'ID', width: 100, sortable: true },
  { key: 'type', label: 'Type', width: 120 },
  { key: 'title', label: 'Title', width: 320, flex: true },
  { key: 'status', label: 'Status', width: 120 },
  { key: 'assignee', label: 'Assignee', width: 160 },
  { key: 'priority', label: 'Priority', width: 130 },
  { key: 'created_at', label: 'Created', width: 130, sortable: true },
  { key: 'updated_at', label: 'Updated', width: 130, sortable: true },
  { key: 'deps', label: 'Deps', width: 80 }
];

/** @type {Map<string, import('lit-html').TemplateResult<1>[]>} */
const type_options_cache = new Map();
/** @type {Map<string, import('lit-html').TemplateResult<1>[]>} */
const status_options_cache = new Map();
/** @type {Map<string, import('lit-html').TemplateResult<1>[]>} */
const priority_options_cache = new Map();

/**
 * Return cached `<option>` templates for the type `<select>`.
 *
 * @param {string} cur_type
 * @returns {import('lit-html').TemplateResult<1>[]}
 */
function getTypeOptions(cur_type) {
  let opts = type_options_cache.get(cur_type);
  if (!opts) {
    opts = ISSUE_TYPES.map(
      (t) =>
        html`<option value=${t} ?selected=${cur_type === t}>
          ${typeLabel(t)}
        </option>`
    );
    type_options_cache.set(cur_type, opts);
  }
  return opts;
}

/**
 * Return cached `<option>` templates for the status `<select>`.
 *
 * @param {string} cur_status
 * @returns {import('lit-html').TemplateResult<1>[]}
 */
function getStatusOptions(cur_status) {
  let opts = status_options_cache.get(cur_status);
  if (!opts) {
    opts = statusOptions(cur_status).map(
      (s) =>
        html`<option
          value=${s}
          ?selected=${cur_status === s}
          ?disabled=${!isSettableStatus(s)}
        >
          ${statusLabel(s)}
        </option>`
    );
    status_options_cache.set(cur_status, opts);
  }
  return opts;
}

/**
 * Return cached `<option>` templates for the priority `<select>`.
 *
 * @param {string} cur_prio
 * @returns {import('lit-html').TemplateResult<1>[]}
 */
function getPriorityOptions(cur_prio) {
  let opts = priority_options_cache.get(cur_prio);
  if (!opts) {
    opts = priority_levels.map(
      (p, i) =>
        html`<option value=${String(i)} ?selected=${cur_prio === String(i)}>
          ${emojiForPriority(i)} ${p}
        </option>`
    );
    priority_options_cache.set(cur_prio, opts);
  }
  return opts;
}

/**
 * Create a reusable issue row renderer used by list and epics views.
 * Handles inline editing for title/assignee and selects for status/priority.
 *
 * Optional hooks let a view repurpose the row without duplicating the cells:
 * `onRowClick` overrides the default navigate-on-click; `getAriaExpanded` marks
 * the row as a disclosure control; `leadingControl` prepends content to the ID
 * cell (e.g. an expand caret); `titleSuffix` appends content after the title
 * (e.g. an epic progress bar). Used by the epics view for epic-level rows.
 *
 * @param {{
 *   navigate: (id: string) => void,
 *   onUpdate: (id: string, patch: { title?: string, assignee?: string, status?: SettableStatus, priority?: number, issue_type?: string }) => Promise<void>,
 *   requestRender: () => void,
 *   getSelectedId?: () => string | null,
 *   row_class?: string,
 *   onRowClick?: (id: string, ev: Event) => void,
 *   getAriaExpanded?: (it: IssueRowData) => boolean | null,
 *   leadingControl?: (it: IssueRowData) => unknown,
 *   titleSuffix?: (it: IssueRowData) => unknown
 * }} options
 * @returns {(it: IssueRowData) => import('lit-html').TemplateResult<1>}
 */
export function createIssueRowRenderer(options) {
  const navigate = options.navigate;
  const on_update = options.onUpdate;
  const request_render = options.requestRender;
  const get_selected_id = options.getSelectedId || (() => null);
  const row_class = options.row_class || 'issue-row';
  const on_row_click = options.onRowClick || ((id) => navigate(id));
  const get_aria_expanded = options.getAriaExpanded || (() => null);
  const leading_control = options.leadingControl || (() => nothing);
  const title_suffix = options.titleSuffix || (() => nothing);

  /** @type {Set<string>} */
  const editing = new Set();

  /**
   * @param {MouseEvent} e
   */
  const onEditableClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const el = /** @type {HTMLElement | null} */ (e.currentTarget);
    const k = el ? el.getAttribute('data-edit-key') : null;
    if (k) {
      editing.add(k);
      request_render();
    }
  };

  /**
   * @param {KeyboardEvent} e
   */
  const onEditableKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const el = /** @type {HTMLElement | null} */ (e.currentTarget);
      const k = el ? el.getAttribute('data-edit-key') : null;
      if (k) {
        editing.add(k);
        request_render();
      }
    }
  };

  /**
   * @param {Event} ev
   */
  const onRowClickHandler = (ev) => {
    const el = /** @type {HTMLElement | null} */ (ev.target);
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
      return;
    }
    const tr = /** @type {HTMLElement | null} */ (ev.currentTarget);
    const id = tr ? tr.getAttribute('data-issue-id') : null;
    if (id) {
      on_row_click(id, ev);
    }
  };

  /**
   * @param {'priority'|'status'|'issue_type'} key
   * @returns {(ev: Event) => Promise<void>}
   */
  function makeSharedSelectChange(key) {
    return async (ev) => {
      const sel = /** @type {HTMLSelectElement} */ (ev.currentTarget);
      const tr = sel ? sel.closest('tr') : null;
      const id = tr ? tr.getAttribute('data-issue-id') : null;
      if (!id) {
        return;
      }
      const val = sel.value || '';
      /** @type {{ [k: string]: any }} */
      const patch = {};
      patch[key] = key === 'priority' ? Number(val) : val;
      await on_update(id, patch);
    };
  }

  const onTypeChange = makeSharedSelectChange('issue_type');
  const onStatusChange = makeSharedSelectChange('status');
  const onPriorityChange = makeSharedSelectChange('priority');

  /**
   * @param {string} id
   * @param {'title'|'assignee'} key
   * @param {string} value
   * @param {string} [placeholder]
   */
  function editableText(id, key, value, placeholder = '') {
    const k = `${id}:${key}`;
    const is_edit = editing.has(k);
    if (is_edit) {
      return html`<span>
        <input
          type="text"
          .value=${value}
          class="inline-edit"
          @keydown=${
            /** @param {KeyboardEvent} e */ async (e) => {
              if (e.key === 'Escape') {
                editing.delete(k);
                request_render();
              } else if (e.key === 'Enter') {
                const el = /** @type {HTMLInputElement} */ (e.currentTarget);
                const next = el.value || '';
                if (next !== value) {
                  await on_update(id, { [key]: next });
                }
                editing.delete(k);
                request_render();
              }
            }
          }
          @blur=${
            /** @param {Event} ev */ async (ev) => {
              const el = /** @type {HTMLInputElement} */ (ev.currentTarget);
              const next = el.value || '';
              if (next !== value) {
                await on_update(id, { [key]: next });
              }
              editing.delete(k);
              request_render();
            }
          }
          autofocus
        />
      </span>`;
    }
    return html`<span
      class="editable text-truncate ${value ? '' : 'muted'}"
      tabindex="0"
      role="button"
      data-edit-key=${k}
      @click=${onEditableClick}
      @keydown=${onEditableKeydown}
      >${value || placeholder}</span
    >`;
  }

  /**
   * @param {IssueRowData} it
   */
  function rowTemplate(it) {
    const cur_status = String(it.status || 'open');
    const cur_prio = String(it.priority ?? 2);
    const cur_type = String(it.issue_type || '');
    const is_selected = get_selected_id() === it.id;
    const expanded = get_aria_expanded(it);
    const suffix = title_suffix(it);
    return html`<tr
      role="row"
      class="${row_class} ${is_selected ? 'selected' : ''}"
      data-issue-id=${it.id}
      aria-expanded=${expanded === null ? nothing : String(expanded)}
      @click=${onRowClickHandler}
    >
      <td role="gridcell" class="mono">
        ${leading_control(it)}${renderIssueIdButton(it.id)}
      </td>
      <td role="gridcell">
        <select
          class="badge-select badge--type type-badge--${cur_type || 'neutral'}"
          .value=${cur_type}
          @change=${onTypeChange}
        >
          ${getTypeOptions(cur_type)}
        </select>
      </td>
      <td role="gridcell">
        ${suffix === nothing
          ? editableText(it.id, 'title', it.title || '')
          : html`<span class="title-with-suffix"
              >${editableText(it.id, 'title', it.title || '')}${suffix}</span
            >`}
      </td>
      <td role="gridcell">
        <select
          class="badge-select badge--status is-${cur_status}"
          .value=${cur_status}
          @change=${onStatusChange}
        >
          ${getStatusOptions(cur_status)}
        </select>
      </td>
      <td role="gridcell">
        ${editableText(it.id, 'assignee', it.assignee || '', 'Unassigned')}
      </td>
      <td role="gridcell">
        <select
          class="badge-select badge--priority ${'is-p' + cur_prio}"
          .value=${cur_prio}
          @change=${onPriorityChange}
        >
          ${getPriorityOptions(cur_prio)}
        </select>
      </td>
      <td
        role="gridcell"
        class="date-col created-col"
        title=${formatDateValue(it.created_at)}
      >
        ${formatDateShort(it.created_at)}
      </td>
      <td
        role="gridcell"
        class="date-col updated-col"
        title=${formatDateValue(it.updated_at)}
      >
        ${formatDateShort(it.updated_at)}
      </td>
      <td role="gridcell" class="deps-col">
        ${(it.dependency_count || 0) > 0 || (it.dependent_count || 0) > 0
          ? html`<span class="deps-indicator"
              >${(it.dependency_count || 0) > 0
                ? html`<span
                    class="dep-count"
                    title="${it.dependency_count} ${(it.dependency_count ||
                      0) === 1
                      ? 'dependency'
                      : 'dependencies'}"
                    >→${it.dependency_count}</span
                  >`
                : ''}${(it.dependent_count || 0) > 0
                ? html`<span
                    class="dependent-count"
                    title="${it.dependent_count} ${(it.dependent_count || 0) ===
                    1
                      ? 'dependent'
                      : 'dependents'}"
                    >←${it.dependent_count}</span
                  >`
                : ''}</span
            >`
          : ''}
      </td>
      ${columnSpacerCell()}
    </tr>`;
  }

  return rowTemplate;
}

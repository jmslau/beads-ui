/**
 * @import { SettableStatus } from '../protocol.js'
 */
import { html, nothing } from 'lit-html';
import { formatDateShort, formatDateValue } from '../utils/date-format.js';
import { createIssueIdRenderer } from '../utils/issue-id-renderer.js';
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
      @click=${
        /** @param {MouseEvent} e */ (e) => {
          e.stopPropagation();
          e.preventDefault();
          editing.add(k);
          request_render();
        }
      }
      @keydown=${
        /** @param {KeyboardEvent} e */ (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            editing.add(k);
            request_render();
          }
        }
      }
      >${value || placeholder}</span
    >`;
  }

  /**
   * @param {string} id
   * @param {'priority'|'status'|'issue_type'} key
   * @returns {(ev: Event) => Promise<void>}
   */
  function makeSelectChange(id, key) {
    return async (ev) => {
      const sel = /** @type {HTMLSelectElement} */ (ev.currentTarget);
      const val = sel.value || '';
      /** @type {{ [k:string]: any }} */
      const patch = {};
      patch[key] = key === 'priority' ? Number(val) : val;
      await on_update(id, patch);
    };
  }

  /**
   * @param {string} id
   * @returns {(ev: Event) => void}
   */
  function makeRowClick(id) {
    return (/** @type {Event} */ ev) => {
      const el = /** @type {HTMLElement|null} */ (ev.target);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
        return;
      }
      on_row_click(id, ev);
    };
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
      @click=${makeRowClick(it.id)}
    >
      <td role="gridcell" class="mono">
        ${leading_control(it)}${createIssueIdRenderer(it.id)}
      </td>
      <td role="gridcell">
        <select
          class="badge-select badge--type type-badge--${cur_type || 'neutral'}"
          .value=${cur_type}
          @change=${makeSelectChange(it.id, 'issue_type')}
        >
          ${ISSUE_TYPES.map(
            (t) =>
              html`<option value=${t} ?selected=${cur_type === t}>
                ${typeLabel(t)}
              </option>`
          )}
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
          @change=${makeSelectChange(it.id, 'status')}
        >
          ${statusOptions(cur_status).map(
            (s) =>
              // An out-of-set current status (e.g. `pinned`) is shown so the
              // select tells the truth, but disabled so it cannot be re-chosen:
              // the server rejects `update-status pinned`.
              html`<option
                value=${s}
                ?selected=${cur_status === s}
                ?disabled=${!isSettableStatus(s)}
              >
                ${statusLabel(s)}
              </option>`
          )}
        </select>
      </td>
      <td role="gridcell">
        ${editableText(it.id, 'assignee', it.assignee || '', 'Unassigned')}
      </td>
      <td role="gridcell">
        <select
          class="badge-select badge--priority ${'is-p' + cur_prio}"
          .value=${cur_prio}
          @change=${makeSelectChange(it.id, 'priority')}
        >
          ${priority_levels.map(
            (p, i) =>
              html`<option
                value=${String(i)}
                ?selected=${cur_prio === String(i)}
              >
                ${emojiForPriority(i)} ${p}
              </option>`
          )}
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

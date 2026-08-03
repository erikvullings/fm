import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';
import type { EntrySummary } from '../../models';
import { entryIcon } from '../directory-table/entry-icons';

/** The F7/Alt+F7 filename search dialog's props (task 0089, filename-search slice). */
export interface FindFilesDialogAttrs {
  readonly open: boolean;
  /** Read-only context shown above the query field, e.g. the active directory's path. */
  readonly scopeLabel: string;
  readonly results: readonly EntrySummary[];
  /** True while a search is in flight (streaming `search.resultsBatch` events). */
  readonly searching: boolean;
  readonly error?: string;
  readonly onSearch: (query: string) => void;
  readonly onCancel: () => void;
  readonly onActivateResult: (entry: EntrySummary) => void;
}

/**
 * Moves focus away from the input before the modal closes, so the browser
 * never has to apply aria-hidden to an ancestor of the focused element.
 */
function blurActive(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** Materialized modal used by the `core.findFiles` (Alt+F7) action. */
export const FindFilesDialog: FactoryComponent<FindFilesDialogAttrs> = () => {
  let query = '';
  let hasSearched = false;
  let wasOpen = false;

  function search(attrs: FindFilesDialogAttrs): void {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    hasSearched = true;
    attrs.onSearch(trimmed);
  }

  function cancel(attrs: FindFilesDialogAttrs): void {
    blurActive();
    attrs.onCancel();
  }

  function activate(attrs: FindFilesDialogAttrs, entry: EntrySummary): void {
    blurActive();
    attrs.onActivateResult(entry);
  }

  return {
    onupdate: ({ attrs }) => {
      // ModalPanel keeps this component (and its input) permanently mounted
      // and only toggles CSS visibility, so a plain oncreate-focus only ever
      // fires once at app boot. Reset state and (re-)focus explicitly on the
      // false->true open transition instead.
      if (attrs.open && !wasOpen) {
        query = '';
        hasSearched = false;
        document.getElementById('find-files-query')?.focus();
      }
      wasOpen = attrs.open;
    },
    view: ({ attrs }) =>
      m(ModalPanel, {
        title: 'Find files',
        className: 'fm-find-files-modal',
        description: m('.fm-find-files-body', [
          m('label.fm-create-directory-field', [
            m('span', `Search in ${attrs.scopeLabel}`),
            m('input#find-files-query', {
              type: 'text',
              value: query,
              placeholder: 'Filename or glob, e.g. *.md',
              oncreate: ({ dom }) => (dom as HTMLInputElement).focus(),
              oninput: (event: InputEvent) => {
                query = (event.currentTarget as HTMLInputElement).value;
              },
              onkeydown: (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  cancel(attrs);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  search(attrs);
                }
              },
            }),
          ]),
          attrs.error === undefined ? undefined : m('.fm-field-error', attrs.error),
          attrs.searching ? m('.fm-find-files-status', 'Searching…') : undefined,
          !attrs.searching && hasSearched && attrs.results.length === 0
            ? m('.fm-find-files-status', 'No matches.')
            : undefined,
          m(
            'ul.fm-find-files-results',
            attrs.results.map((entry) =>
              m(
                'li',
                {
                  key: entry.id,
                  onclick: () => activate(attrs, entry),
                },
                [
                  entryIcon(entry),
                  m('span', [m('strong', entry.name), m('small', entry.location.uri)]),
                ],
              ),
            ),
          ),
        ]),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) cancel(attrs);
        },
        buttons: [
          { label: 'Cancel', onclick: () => cancel(attrs) },
          {
            label: 'Search',
            disabled: query.trim().length === 0,
            onclick: () => search(attrs),
          },
        ],
      }),
  };
};

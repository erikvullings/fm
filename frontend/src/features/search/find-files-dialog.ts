import m, { type FactoryComponent } from 'mithril';
import { FlatButton, ModalPanel } from 'mithril-materialized';

/** Parameters passed to the search callback by the find-files dialog (task 0089). */
export interface FindFilesSearchParams {
  /** Filename/glob query. */
  readonly filenameQuery: string;
  /** Optional content-search query. */
  readonly contentQuery?: string | undefined;
  /** Treat content query as regex. */
  readonly contentRegex: boolean;
  /** Search recursively into subdirectories. */
  readonly recurse: boolean;
}

/** The F7/Alt+F7 search dialog's props (task 0089). */
export interface FindFilesDialogAttrs {
  readonly open: boolean;
  /** Read-only context shown above the query field, e.g. the active directory's path. */
  readonly scopeLabel: string;
  readonly error?: string;
  readonly onSearch: (params: FindFilesSearchParams) => void;
  readonly onCancel: () => void;
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
  let filenameQuery = '';
  let contentQuery = '';
  let contentRegex = false;
  let recurse = true;
  let wasOpen = false;

  function search(attrs: FindFilesDialogAttrs): void {
    const trimmedFilename = filenameQuery.trim();
    const trimmedContent = contentQuery.trim();
    if (trimmedFilename.length === 0 && trimmedContent.length === 0) return;
    blurActive();
    attrs.onSearch({
      filenameQuery: trimmedFilename,
      contentQuery: trimmedContent.length > 0 ? trimmedContent : undefined,
      contentRegex,
      recurse,
    });
  }

  function cancel(attrs: FindFilesDialogAttrs): void {
    blurActive();
    attrs.onCancel();
  }

  return {
    onupdate: ({ attrs }) => {
      if (attrs.open && !wasOpen) {
        const input = document.getElementById('find-files-query');
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }
      wasOpen = attrs.open;
    },
    view: ({ attrs }) =>
      m(ModalPanel, {
        id: 'find-files-dialog',
        title: 'Find files',
        className: 'fm-find-files-modal',
        description: m('.fm-find-files-body', [
          // Filename query
          m('label.fm-create-directory-field', [
            m('span', `Search in ${attrs.scopeLabel}`),
            m('input#find-files-query', {
              type: 'text',
              value: filenameQuery,
              placeholder: 'Filename or glob, e.g. *.md',
              // No oncreate-focus here: ModalPanel keeps this input permanently mounted
              // and only toggles CSS visibility, so an oncreate-focus would only ever
              // fire once at app boot (before the dialog is ever shown) - and doing so
              // poisons ModalPanel's own focus-restore-on-close logic, which captures
              // whatever is focused when the dialog opens and refocuses it when the
              // dialog closes. The onupdate hook below focuses on the real open
              // transition instead.
              oninput: (event: InputEvent) => {
                filenameQuery = (event.currentTarget as HTMLInputElement).value;
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
          // Content query
          m('label.fm-create-directory-field', [
            m('span', 'Content'),
            m('input', {
              type: 'text',
              value: contentQuery,
              placeholder: 'Text or regex to find in files',
              oninput: (event: InputEvent) => {
                contentQuery = (event.currentTarget as HTMLInputElement).value;
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
          // Options row
          m('div.fm-find-files-options', [
            m(
              FlatButton,
              {
                type: 'checkbox',
                checked: contentRegex,
                onclick: () => {
                  contentRegex = !contentRegex;
                  m.redraw();
                },
              },
              'Use regex',
            ),
            m(
              FlatButton,
              {
                type: 'checkbox',
                checked: recurse,
                onclick: () => {
                  recurse = !recurse;
                  m.redraw();
                },
              },
              recurse ? 'Recurse subdirectories' : 'Current directory only',
            ),
          ]),
          attrs.error === undefined ? undefined : m('.fm-field-error', attrs.error),
        ]),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open && attrs.open) cancel(attrs);
        },
        buttons: [
          { label: 'Cancel', onclick: () => cancel(attrs) },
          {
            label: 'Search',
            disabled: filenameQuery.trim().length === 0 && contentQuery.trim().length === 0,
            onclick: () => search(attrs),
          },
        ],
      }),
  };
};

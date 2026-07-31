import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

export interface CreateDirectoryDialogAttrs {
  readonly open: boolean;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}

/** Validates a single cross-platform-safe directory name. */
export function validateDirectoryName(name: string): string | undefined {
  if (name.length === 0) return 'Enter a folder name.';
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return 'Use a single folder name.';
  }
  if (name.includes('\0') || /[<>:"|?*]/u.test(name)) {
    return 'The name contains invalid characters.';
  }
  const stem = name.split('.')[0]?.trimEnd().toUpperCase();
  if (
    stem !== undefined &&
    (/^(?:CON|PRN|AUX|NUL)$/u.test(stem) || /^(?:COM|LPT)[1-9]$/u.test(stem))
  ) {
    return 'That name is reserved by Windows.';
  }
  return undefined;
}

/** Materialized modal used by the F7 create-directory action. */
export const CreateDirectoryDialog: FactoryComponent<CreateDirectoryDialogAttrs> = () => {
  let name = '';
  let error: string | undefined;

  function confirm(attrs: CreateDirectoryDialogAttrs): void {
    error = validateDirectoryName(name);
    if (error === undefined) attrs.onConfirm(name);
  }

  return {
    view: ({ attrs }) =>
      m(ModalPanel, {
        title: 'New folder',
        description: m('label.fm-create-directory-field', [
          m('span', 'Folder name'),
          m('input#create-directory-name', {
            type: 'text',
            value: name,
            required: true,
            autofocus: true,
            'aria-invalid': error === undefined ? undefined : 'true',
            oncreate: ({ dom }) => (dom as HTMLInputElement).focus(),
            oninput: (event: InputEvent) => {
              name = (event.currentTarget as HTMLInputElement).value;
              error = validateDirectoryName(name);
            },
            onkeydown: (event: KeyboardEvent) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                attrs.onCancel();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                confirm(attrs);
              }
            },
          }),
          error === undefined ? undefined : m('.fm-field-error', error),
        ]),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) attrs.onCancel();
        },
        buttons: [
          { label: 'Cancel', onclick: attrs.onCancel },
          {
            label: 'Create',
            disabled: validateDirectoryName(name) !== undefined,
            onclick: () => confirm(attrs),
          },
        ],
      }),
  };
};

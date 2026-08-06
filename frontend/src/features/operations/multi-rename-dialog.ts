import m, { type FactoryComponent } from 'mithril';
import { ModalPanel } from 'mithril-materialized';

import {
  type CaseTransform,
  canApplyRenamePlan,
  EMPTY_MULTI_RENAME_RULES,
  type MultiRenameRules,
  proposeRenames,
  type RenameProposal,
  type RenameTarget,
  validateSearchPattern,
} from './multi-rename-rules';

export interface MultiRenameDialogAttrs {
  readonly open: boolean;
  /** The current selection, in the order rules such as the sequence counter are applied. */
  readonly entries: readonly RenameTarget[];
  /** Every other name in the same directory, excluding the entries being renamed. */
  readonly existingSiblingNames: ReadonlySet<string>;
  readonly onApply: (renamed: readonly { id: string; newName: string }[]) => void;
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

function collisionLabel(proposal: RenameProposal): string | undefined {
  if (proposal.invalidNameReason !== undefined) return proposal.invalidNameReason;
  if (proposal.collision === 'plan') return 'Collides with another renamed entry.';
  if (proposal.collision === 'existing') return 'Collides with an existing entry.';
  return undefined;
}

/** The F2 multi-selection rename dialog (task 0072), modeled on Total Commander's tool. */
export const MultiRenameDialog: FactoryComponent<MultiRenameDialogAttrs> = () => {
  let rules: MultiRenameRules = EMPTY_MULTI_RENAME_RULES;
  let sequenceEnabled = false;
  let sequenceStart = 1;
  let sequenceStep = 1;
  let sequencePadding = 1;
  let wasOpen = false;

  function reset(): void {
    rules = EMPTY_MULTI_RENAME_RULES;
    sequenceEnabled = false;
    sequenceStart = 1;
    sequenceStep = 1;
    sequencePadding = 1;
  }

  function update(patch: Partial<MultiRenameRules>): void {
    rules = { ...rules, ...patch };
  }

  function updateSequence(): void {
    const { sequence: _sequence, ...withoutSequence } = rules;
    rules = sequenceEnabled
      ? {
          ...withoutSequence,
          sequence: { start: sequenceStart, step: sequenceStep, padding: sequencePadding },
        }
      : withoutSequence;
  }

  function cancel(attrs: MultiRenameDialogAttrs): void {
    blurActive();
    attrs.onCancel();
  }

  function apply(attrs: MultiRenameDialogAttrs, plan: readonly RenameProposal[]): void {
    if (!canApplyRenamePlan(plan)) return;
    blurActive();
    attrs.onApply(
      plan
        .filter((proposal) => proposal.changed)
        .map((proposal) => ({ id: proposal.id, newName: proposal.newName })),
    );
  }

  return {
    view: ({ attrs }) => {
      // ModalPanel keeps this component permanently mounted and only toggles CSS visibility, so
      // reset state on the false->true open transition here (synchronously, before rendering)
      // rather than in onupdate, which would only take effect on a subsequent redraw.
      if (attrs.open && !wasOpen) reset();
      wasOpen = attrs.open;

      const searchError = validateSearchPattern(rules.search, rules.useRegex);
      const plan =
        searchError === undefined
          ? proposeRenames(attrs.entries, rules, attrs.existingSiblingNames)
          : attrs.entries.map((entry) => ({
              id: entry.id,
              oldName: entry.name,
              newName: entry.name,
              changed: false,
            }));
      const canApply = searchError === undefined && canApplyRenamePlan(plan);

      return m(ModalPanel, {
        id: 'multi-rename-dialog',
        title: `Rename ${attrs.entries.length} items`,
        className: 'fm-multi-rename-modal',
        description: m('.fm-multi-rename-body', [
          m('.fm-multi-rename-rules', [
            m('label.fm-multi-rename-field', [
              m('span', 'Search'),
              m('input#multi-rename-search', {
                type: 'text',
                value: rules.search,
                oninput: (event: InputEvent) => {
                  update({ search: (event.currentTarget as HTMLInputElement).value });
                },
              }),
            ]),
            m('label.fm-multi-rename-field', [
              m('span', 'Replace'),
              m('input#multi-rename-replace', {
                type: 'text',
                value: rules.replace,
                oninput: (event: InputEvent) => {
                  update({ replace: (event.currentTarget as HTMLInputElement).value });
                },
              }),
            ]),
            m('label.fm-multi-rename-checkbox', [
              m('input', {
                type: 'checkbox',
                checked: rules.useRegex,
                onchange: (event: Event) => {
                  update({ useRegex: (event.currentTarget as HTMLInputElement).checked });
                },
              }),
              m('span', 'Regular expression'),
            ]),
            searchError === undefined ? undefined : m('.fm-field-error', searchError),
            m('label.fm-multi-rename-field', [
              m('span', 'Prefix'),
              m('input#multi-rename-prefix', {
                type: 'text',
                value: rules.prefix,
                oninput: (event: InputEvent) => {
                  update({ prefix: (event.currentTarget as HTMLInputElement).value });
                },
              }),
            ]),
            m('label.fm-multi-rename-field', [
              m('span', 'Suffix'),
              m('input#multi-rename-suffix', {
                type: 'text',
                value: rules.suffix,
                oninput: (event: InputEvent) => {
                  update({ suffix: (event.currentTarget as HTMLInputElement).value });
                },
              }),
            ]),
            m('label.fm-multi-rename-checkbox', [
              m('input', {
                type: 'checkbox',
                checked: sequenceEnabled,
                onchange: (event: Event) => {
                  sequenceEnabled = (event.currentTarget as HTMLInputElement).checked;
                  updateSequence();
                },
              }),
              m('span', 'Counter [C]'),
            ]),
            m('.fm-multi-rename-sequence', [
              m('label.fm-multi-rename-field', [
                m('span', 'Start'),
                m('input#multi-rename-sequence-start', {
                  type: 'number',
                  disabled: !sequenceEnabled,
                  value: sequenceStart,
                  oninput: (event: InputEvent) => {
                    sequenceStart = Number((event.currentTarget as HTMLInputElement).value);
                    updateSequence();
                  },
                }),
              ]),
              m('label.fm-multi-rename-field', [
                m('span', 'Step'),
                m('input#multi-rename-sequence-step', {
                  type: 'number',
                  disabled: !sequenceEnabled,
                  value: sequenceStep,
                  oninput: (event: InputEvent) => {
                    sequenceStep = Number((event.currentTarget as HTMLInputElement).value);
                    updateSequence();
                  },
                }),
              ]),
              m('label.fm-multi-rename-field', [
                m('span', 'Digits'),
                m('input#multi-rename-sequence-digits', {
                  type: 'number',
                  min: '1',
                  disabled: !sequenceEnabled,
                  value: sequencePadding,
                  oninput: (event: InputEvent) => {
                    sequencePadding = Math.max(
                      1,
                      Number((event.currentTarget as HTMLInputElement).value),
                    );
                    updateSequence();
                  },
                }),
              ]),
            ]),
            m('label.fm-multi-rename-field', [
              m('span', 'Case'),
              m(
                'select#multi-rename-case',
                {
                  value: rules.caseTransform,
                  onchange: (event: Event) => {
                    update({
                      caseTransform: (event.currentTarget as HTMLSelectElement)
                        .value as CaseTransform,
                    });
                  },
                },
                [
                  m('option', { value: 'unchanged' }, 'Unchanged'),
                  m('option', { value: 'upper' }, 'UPPERCASE'),
                  m('option', { value: 'lower' }, 'lowercase'),
                  m('option', { value: 'title' }, 'Title Case'),
                ],
              ),
            ]),
          ]),
          m('table.fm-multi-rename-preview', [
            m('thead', m('tr', [m('th', 'Old name'), m('th', 'New name')])),
            m(
              'tbody',
              plan.map((proposal) => {
                const problem = collisionLabel(proposal);
                return m(
                  'tr',
                  {
                    key: proposal.id,
                    className: problem === undefined ? undefined : 'fm-multi-rename-row--problem',
                  },
                  [
                    m('td', proposal.oldName),
                    m('td', [
                      proposal.newName,
                      problem === undefined ? undefined : m('.fm-field-error', problem),
                    ]),
                  ],
                );
              }),
            ),
          ]),
        ]),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) cancel(attrs);
        },
        buttons: [
          { label: 'Cancel', onclick: () => cancel(attrs) },
          {
            label: 'Rename',
            disabled: !canApply,
            onclick: () => apply(attrs, plan),
          },
        ],
      });
    },
  };
};

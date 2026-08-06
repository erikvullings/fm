import m, { type FactoryComponent } from 'mithril';
import { InputCheckbox, ModalPanel, NumberInput, Select, TextInput } from 'mithril-materialized';

import {
  type CaseTransform,
  canApplyRenamePlan,
  EMPTY_MULTI_RENAME_RULES,
  type MultiRenameRules,
  proposeRenames,
  type RenameProposal,
  type RenameTarget,
  type SequenceRule,
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
  let wasOpen = false;

  function reset(): void {
    rules = EMPTY_MULTI_RENAME_RULES;
  }

  function update(patch: Partial<MultiRenameRules>): void {
    rules = { ...rules, ...patch };
  }

  function updateSequence(patch: Partial<SequenceRule>): void {
    update({ sequence: { ...rules.sequence, ...patch } });
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
        fixedFooter: true,
        description: m('.fm-multi-rename-body', [
          m('.ignored-fm-multi-rename-rules', [
            m(
              'div',
              {
                style: {
                  border: '1px solid var(--fm-border)',
                  borderRadius: '4px',
                  paddingTop: '8px',
                },
              },
              [
                m(
                  '.row',
                  { style: { marginBottom: '8px' } },
                  m(TextInput, {
                    id: 'multi-rename-name-mask',
                    label: 'Rename mask',
                    helperText: '[N] name, [N#-#] range, [C] counter, [YMD] date, [hms] time',
                    className: 'col s8',
                    value: rules.nameMask,
                    oninput: (nameMask) => {
                      update({ nameMask });
                    },
                  }),
                  m(TextInput, {
                    id: 'multi-rename-extension-mask',
                    label: 'Extension',
                    helperText: '[E] ext, [E#-#], [C]',
                    className: 'col s4',
                    value: rules.extensionMask,
                    oninput: (extensionMask) => {
                      update({ extensionMask });
                    },
                  }),

                  m(NumberInput, {
                    id: 'multi-rename-sequence-start',
                    label: 'Counter start at',
                    className: 'col s4',
                    value: rules.sequence.start,
                    oninput: (start) => {
                      updateSequence({ start });
                    },
                  }),
                  m(NumberInput, {
                    id: 'multi-rename-sequence-step',
                    label: 'Step by',
                    className: 'col s4',
                    value: rules.sequence.step,
                    oninput: (step) => {
                      updateSequence({ step });
                    },
                  }),
                  m(NumberInput, {
                    id: 'multi-rename-sequence-padding',
                    label: 'Digits',
                    className: 'col s4',
                    value: rules.sequence.padding,
                    oninput: (padding) => {
                      updateSequence({ padding });
                    },
                  }),
                ),
              ],
            ),
            m(
              'div',
              {
                style: {
                  border: '1px solid var(--fm-border)',
                  borderRadius: '4px',
                  paddingTop: '8px',
                  marginTop: '12px',
                },
              },
              m(
                '.row',
                { style: { marginBottom: '8px' } },
                m(TextInput, {
                  id: 'multi-rename-search',
                  label: 'Search for',
                  className: 'col s4',
                  value: rules.search,
                  oninput: (search) => {
                    update({ search });
                  },
                }),
                m(TextInput, {
                  id: 'multi-rename-replace',
                  label: 'Replace with',
                  className: 'col s4',
                  value: rules.replace,
                  oninput: (replace) => {
                    update({ replace });
                  },
                }),
                m(InputCheckbox, {
                  inputId: 'multi-rename-use-regex',
                  label: 'Use regex',
                  className: 'col s4',
                  style: { marginTop: '16px' },
                  checked: rules.useRegex,
                  onchange: (useRegex) => {
                    update({ useRegex });
                  },
                }),
              ),
              searchError === undefined ? undefined : m('.fm-field-error', searchError),
            ),

            m(
              '.row',
              {
                style: {
                  border: '1px solid var(--fm-border)',
                  borderRadius: '4px',
                  padding: '8px 0',
                  margin: '12px auto 8px auto',
                },
              },
              m(Select, {
                id: 'multi-rename-case',
                label: 'Case',
                options: [
                  { id: 'unchanged', label: 'Unchanged' },
                  { id: 'upper', label: 'UPPERCASE' },
                  { id: 'lower', label: 'lowercase' },
                  { id: 'title', label: 'Title Case' },
                ],
                checkedId: rules.caseTransform,
                onchange: (v) => update({ caseTransform: v[0] as CaseTransform }),
              }),
            ),
          ]),
          m('.fm-multi-rename-preview-container', [
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

import { validateDirectoryName } from './create-directory-dialog';

/** How the whole proposed name is cased after every other rule has been applied. */
export type CaseTransform = 'unchanged' | 'upper' | 'lower' | 'title';

/** A counter appended to each proposed name, in selection order. */
export interface SequenceRule {
  readonly start: number;
  readonly step: number;
  readonly padding: number;
}

/** The rule set configured in the multi-rename dialog (spec §16). */
export interface MultiRenameRules {
  readonly search: string;
  readonly replace: string;
  readonly useRegex: boolean;
  readonly prefix: string;
  readonly suffix: string;
  readonly sequence?: SequenceRule;
  readonly caseTransform: CaseTransform;
}

export const EMPTY_MULTI_RENAME_RULES: MultiRenameRules = {
  search: '',
  replace: '',
  useRegex: false,
  prefix: '',
  suffix: '',
  caseTransform: 'unchanged',
};

/** A minimal view of a selected entry, sufficient to compute a rename proposal. */
export interface RenameTarget {
  readonly id: string;
  readonly name: string;
}

/** Why a proposed name collides with another one. */
export type RenameCollisionKind = 'plan' | 'existing';

/** One row of the multi-rename preview table. */
export interface RenameProposal {
  readonly id: string;
  readonly oldName: string;
  readonly newName: string;
  readonly changed: boolean;
  readonly invalidNameReason?: string;
  readonly collision?: RenameCollisionKind;
}

/** Validates a search pattern before it is used, so a bad regex never throws mid-preview. */
export function validateSearchPattern(pattern: string, useRegex: boolean): string | undefined {
  if (!useRegex || pattern.length === 0) return undefined;
  try {
    // eslint-disable-next-line no-new -- validation only, the instance itself is unused
    new RegExp(pattern);
    return undefined;
  } catch {
    return 'That search pattern is not a valid regular expression.';
  }
}

function splitExtension(name: string): { stem: string; extension: string } {
  const lastDot = name.lastIndexOf('.');
  // No extension, or a leading dot (dotfile) with nothing before it: keep the whole name as the
  // stem so a leading dot is never mistaken for an empty-stem extension.
  if (lastDot <= 0) return { stem: name, extension: '' };
  return { stem: name.slice(0, lastDot), extension: name.slice(lastDot) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function applySearchReplace(stem: string, rules: MultiRenameRules): string {
  if (rules.search.length === 0) return stem;
  if (rules.useRegex) {
    if (validateSearchPattern(rules.search, true) !== undefined) return stem;
    return stem.replace(new RegExp(rules.search, 'gu'), rules.replace);
  }
  return stem.replace(new RegExp(escapeRegExp(rules.search), 'gu'), rules.replace);
}

function applyCaseTransform(name: string, extension: string, transform: CaseTransform): string {
  switch (transform) {
    case 'upper':
      return `${name}${extension}`.toUpperCase();
    case 'lower':
      return `${name}${extension}`.toLowerCase();
    case 'title':
      // Title-casing only makes sense on the words in the name itself; the extension is left
      // as-is (an all-caps ".JPG" wouldn't become ".Jpg").
      return `${name.replace(/\b\w/gu, (letter) => letter.toUpperCase())}${extension}`;
    case 'unchanged':
      return `${name}${extension}`;
  }
}

function formatSequence(index: number, sequence: SequenceRule): string {
  const value = sequence.start + index * sequence.step;
  return String(Math.abs(value)).padStart(sequence.padding, '0');
}

/** Composes every rule into a single proposed name for one entry. */
export function proposeName(entry: RenameTarget, index: number, rules: MultiRenameRules): string {
  const { stem, extension } = splitExtension(entry.name);
  const replaced = applySearchReplace(stem, rules);
  const sequenceToken = rules.sequence === undefined ? '' : formatSequence(index, rules.sequence);
  const composed = `${rules.prefix}${replaced}${sequenceToken}${rules.suffix}`;
  return applyCaseTransform(composed, extension, rules.caseTransform);
}

function foldForCollision(name: string): string {
  return name.toLocaleLowerCase();
}

/**
 * Computes a rename proposal for every entry, including collision and invalid-name detection.
 *
 * `existingSiblingNames` must exclude the entries being renamed themselves, so that a case-only
 * self-rename is never mistaken for a collision with its own original name.
 */
export function proposeRenames(
  entries: readonly RenameTarget[],
  rules: MultiRenameRules,
  existingSiblingNames: ReadonlySet<string>,
): RenameProposal[] {
  const foldedExisting = new Set(Array.from(existingSiblingNames, foldForCollision));
  const newNames = entries.map((entry, index) => proposeName(entry, index, rules));
  const foldedCounts = new Map<string, number>();
  for (const name of newNames) {
    const folded = foldForCollision(name);
    foldedCounts.set(folded, (foldedCounts.get(folded) ?? 0) + 1);
  }

  return entries.map((entry, index) => {
    const newName = newNames[index] ?? entry.name;
    const changed = newName !== entry.name;
    const folded = foldForCollision(newName);
    const invalidNameReason = validateDirectoryName(newName);
    const collision: RenameCollisionKind | undefined =
      (foldedCounts.get(folded) ?? 0) > 1
        ? 'plan'
        : foldedExisting.has(folded)
          ? 'existing'
          : undefined;
    return {
      id: entry.id,
      oldName: entry.name,
      newName,
      changed,
      ...(invalidNameReason === undefined ? {} : { invalidNameReason }),
      ...(collision === undefined ? {} : { collision }),
    };
  });
}

/** Whether the current plan is safe to apply: at least one real change, no blockers. */
export function canApplyRenamePlan(proposals: readonly RenameProposal[]): boolean {
  const changed = proposals.filter((proposal) => proposal.changed);
  if (changed.length === 0) return false;
  return changed.every(
    (proposal) => proposal.invalidNameReason === undefined && proposal.collision === undefined,
  );
}

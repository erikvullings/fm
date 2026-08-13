import type { ActionDescriptor, EntrySummary } from '../../models';
import { archiveRootForEntry } from '../navigation/archive-location';

/** Context the frontend uses to advise which registered commands can run. */
export interface CommandAvailabilityContext {
  readonly selectedEntries: readonly EntrySummary[];
  readonly locationWritable: boolean;
  readonly clipboardHasEntries: boolean;
  readonly openTerminalSupported: boolean;
}

export interface AvailableAction {
  readonly action: ActionDescriptor;
  readonly available: boolean;
  readonly reason?: string;
}

const LOCATION_ACTION_IDS = new Set([
  'core.createDirectory',
  'core.paste',
  'core.refresh',
  'core.openTerminal',
]);

const SELECTION_ACTION_IDS = new Set([
  'core.open',
  'core.view',
  'core.edit',
  'core.openWith',
  'core.revealInSystemFileManager',
  'core.copy',
  'core.move',
  'core.rename',
  'core.trash',
  'core.delete',
  'core.copyName',
  'core.copyPath',
  'core.copyRelativePath',
  'core.pack',
  'core.moveToArchive',
  'core.extract',
]);

const CONTEXT_MENU_SELECTION_ORDER = new Map([
  ['core.copyName', 0],
  ['core.copyPath', 1],
  ['core.copyRelativePath', 2],
]);

// `core.trash` is deliberately excluded: unlike rename/move/permanent-delete,
// trashing is reversible and requires no `overrideReadOnly` escape hatch, so
// read-only selected entries stay trashable (task 0043).
const WRITE_SELECTION_ACTION_IDS = new Set(['core.rename', 'core.move', 'core.delete']);

function unavailable(action: ActionDescriptor, reason: string): AvailableAction {
  return { action, available: false, reason };
}

/**
 * Evaluates the registry requirements plus client-only context that the
 * backend re-validates when a command reaches its operation endpoint.
 */
export function evaluateActionAvailability(
  action: ActionDescriptor,
  context: CommandAvailabilityContext,
): AvailableAction {
  const requirements = action.contextRequirements;
  if (requirements.featureAvailable === false) return unavailable(action, 'Not available yet');
  if (requirements.requiresSingleSelection && context.selectedEntries.length !== 1) {
    return unavailable(action, 'Select exactly one item');
  }
  if (requirements.requiresSelection && context.selectedEntries.length === 0) {
    return unavailable(action, 'Select an item first');
  }
  const soleSelectedEntry =
    context.selectedEntries.length === 1 ? context.selectedEntries[0] : undefined;
  if (
    action.id === 'core.extract' &&
    soleSelectedEntry !== undefined &&
    archiveRootForEntry(soleSelectedEntry) === undefined
  ) {
    return unavailable(action, 'Select an archive file');
  }
  if (action.id === 'core.openTerminal' && !context.openTerminalSupported) {
    return unavailable(action, 'Terminal is not supported by this host');
  }
  if (
    (action.id === 'core.createDirectory' || action.id === 'core.paste') &&
    !context.locationWritable
  ) {
    return unavailable(action, 'This location is read-only');
  }
  if (action.id === 'core.paste' && !context.clipboardHasEntries) {
    return unavailable(action, 'Copy or move an item first');
  }
  if (
    WRITE_SELECTION_ACTION_IDS.has(action.id) &&
    context.selectedEntries.some((entry) => entry.readOnly)
  ) {
    return unavailable(action, 'Selected item is read-only');
  }
  return { action, available: true };
}

/** Evaluates all registry actions with the same pure predicate. */
export function availableActions(
  actions: readonly ActionDescriptor[],
  context: CommandAvailabilityContext,
): readonly AvailableAction[] {
  return actions.map((action) => evaluateActionAvailability(action, context));
}

/** Selects the registered actions appropriate for a directory-table context menu. */
export function menuActionsForContext(
  actions: readonly ActionDescriptor[],
  context: CommandAvailabilityContext,
): readonly AvailableAction[] {
  const selected = context.selectedEntries.length > 0;
  const matchingActions = actions.filter((action) =>
    selected ? SELECTION_ACTION_IDS.has(action.id) : LOCATION_ACTION_IDS.has(action.id),
  );
  if (selected) {
    matchingActions.sort(
      (left, right) =>
        (CONTEXT_MENU_SELECTION_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (CONTEXT_MENU_SELECTION_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return availableActions(matchingActions, context);
}

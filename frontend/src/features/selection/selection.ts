import type { EntryId, EntrySummary, Location } from '../../models';

/** Stable-ID selection state for one pane. */
export interface SelectionState {
  readonly selectedEntryIds: readonly EntryId[];
  readonly cursorEntryId?: EntryId;
  readonly anchorEntryId?: EntryId;
  /** Entries frozen from a prior multi-selection so Shift-extend unions rather than replaces. */
  readonly baseSelectedEntryIds?: readonly EntryId[];
}

/** Framework-independent transitions supported by the directory selection model. */
export type SelectionAction =
  | { readonly type: 'moveCursor'; readonly offset: number }
  | { readonly type: 'moveCursorTo'; readonly edge: 'first' | 'last' }
  | { readonly type: 'setCursor'; readonly entryId: EntryId }
  | { readonly type: 'selectOnly'; readonly entryId: EntryId }
  | { readonly type: 'toggle'; readonly entryId: EntryId }
  | { readonly type: 'extendRange'; readonly offset: number }
  | { readonly type: 'extendRangeTo'; readonly entryId: EntryId }
  | { readonly type: 'selectAll' }
  | { readonly type: 'invert' }
  | { readonly type: 'selectByMask'; readonly matchingEntryIds: readonly EntryId[] }
  | { readonly type: 'deselectByMask'; readonly matchingEntryIds: readonly EntryId[] }
  | { readonly type: 'clear' }
  | { readonly type: 'prune'; readonly removedEntryIds: readonly EntryId[] };

export const emptySelection: SelectionState = { selectedEntryIds: [] };

function clampedIndex(index: number, entryIds: readonly EntryId[]): number | undefined {
  if (entryIds.length === 0) {
    return undefined;
  }
  return Math.max(0, Math.min(index, entryIds.length - 1));
}

function cursorIndex(state: SelectionState, entryIds: readonly EntryId[]): number {
  const index = state.cursorEntryId === undefined ? -1 : entryIds.indexOf(state.cursorEntryId);
  return index < 0 ? 0 : index;
}

/** Applies one selection transition using the entries in their current visible order. */
export function reduceSelection(
  state: SelectionState,
  action: SelectionAction,
  orderedEntryIds: readonly EntryId[],
): SelectionState {
  const visibleIds = new Set(orderedEntryIds);
  switch (action.type) {
    case 'moveCursor': {
      const index = clampedIndex(
        cursorIndex(state, orderedEntryIds) + action.offset,
        orderedEntryIds,
      );
      const entryId = index === undefined ? undefined : orderedEntryIds[index];
      if (entryId === undefined) return state;
      // Keep an existing multi-selection when navigating without Shift so users can skip
      // entries and continue extending selection later.
      if (
        state.selectedEntryIds.length > 1 &&
        state.selectedEntryIds.every((selectedId) => visibleIds.has(selectedId))
      ) {
        return {
          ...state,
          cursorEntryId: entryId,
          anchorEntryId: entryId,
          baseSelectedEntryIds: state.selectedEntryIds,
        };
      }
      const { baseSelectedEntryIds: _b1, ...withoutBase1 } = state;
      return {
        ...withoutBase1,
        selectedEntryIds: [entryId],
        cursorEntryId: entryId,
        anchorEntryId: entryId,
      };
    }
    case 'moveCursorTo': {
      const entryId = action.edge === 'first' ? orderedEntryIds[0] : orderedEntryIds.at(-1);
      if (entryId === undefined) return state;
      if (
        state.selectedEntryIds.length > 1 &&
        state.selectedEntryIds.every((selectedId) => visibleIds.has(selectedId))
      ) {
        return {
          ...state,
          cursorEntryId: entryId,
          anchorEntryId: entryId,
          baseSelectedEntryIds: state.selectedEntryIds,
        };
      }
      const { baseSelectedEntryIds: _b2, ...withoutBase2 } = state;
      return {
        ...withoutBase2,
        selectedEntryIds: [entryId],
        cursorEntryId: entryId,
        anchorEntryId: entryId,
      };
    }
    case 'setCursor':
      return { ...state, cursorEntryId: action.entryId };
    case 'selectOnly':
      return {
        selectedEntryIds: [action.entryId],
        cursorEntryId: action.entryId,
        anchorEntryId: action.entryId,
      };
    case 'toggle': {
      const selected = new Set(state.selectedEntryIds);
      if (selected.has(action.entryId)) {
        selected.delete(action.entryId);
      } else {
        selected.add(action.entryId);
      }
      return {
        selectedEntryIds: [...selected],
        cursorEntryId: action.entryId,
        anchorEntryId: action.entryId,
      };
    }
    case 'extendRange': {
      if (orderedEntryIds.length === 0) {
        return state;
      }
      const currentIndex = cursorIndex(state, orderedEntryIds);
      const nextIndex = clampedIndex(currentIndex + action.offset, orderedEntryIds) ?? currentIndex;
      const anchorEntryId =
        state.anchorEntryId ?? state.cursorEntryId ?? orderedEntryIds[currentIndex];
      const anchorIndex =
        anchorEntryId === undefined ? currentIndex : orderedEntryIds.indexOf(anchorEntryId);
      const rangeStart = Math.min(anchorIndex < 0 ? currentIndex : anchorIndex, nextIndex);
      const rangeEnd = Math.max(anchorIndex < 0 ? currentIndex : anchorIndex, nextIndex);
      const rangeIds = orderedEntryIds.slice(rangeStart, rangeEnd + 1);
      const base = state.baseSelectedEntryIds;
      const baseSet = base !== undefined ? new Set(base) : undefined;
      const merged =
        baseSet !== undefined
          ? orderedEntryIds.filter((id) => baseSet.has(id) || rangeIds.includes(id))
          : rangeIds;
      return {
        selectedEntryIds: merged,
        ...(orderedEntryIds[nextIndex] === undefined
          ? {}
          : { cursorEntryId: orderedEntryIds[nextIndex] }),
        ...(anchorEntryId === undefined ? {} : { anchorEntryId }),
        ...(base !== undefined ? { baseSelectedEntryIds: base } : {}),
      };
    }
    case 'extendRangeTo': {
      const targetIndex = orderedEntryIds.indexOf(action.entryId);
      if (targetIndex < 0) {
        return state;
      }
      const anchorEntryId = state.anchorEntryId ?? state.cursorEntryId ?? action.entryId;
      const anchorIndex = orderedEntryIds.indexOf(anchorEntryId);
      const rangeStart = Math.min(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
      const rangeEnd = Math.max(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
      const rangeIds = orderedEntryIds.slice(rangeStart, rangeEnd + 1);
      const base = state.baseSelectedEntryIds;
      const baseSet = base !== undefined ? new Set(base) : undefined;
      const merged =
        baseSet !== undefined
          ? orderedEntryIds.filter((id) => baseSet.has(id) || rangeIds.includes(id))
          : rangeIds;
      return {
        selectedEntryIds: merged,
        cursorEntryId: action.entryId,
        anchorEntryId,
        ...(base !== undefined ? { baseSelectedEntryIds: base } : {}),
      };
    }
    case 'selectAll':
      return { ...state, selectedEntryIds: [...orderedEntryIds] };
    case 'invert': {
      const selected = new Set(state.selectedEntryIds);
      return {
        ...state,
        selectedEntryIds: orderedEntryIds.filter((entryId) => !selected.has(entryId)),
      };
    }
    case 'selectByMask': {
      if (action.matchingEntryIds.length === 0) return state;
      const selected = new Set([...state.selectedEntryIds, ...action.matchingEntryIds]);
      const visible = orderedEntryIds.filter((entryId) => selected.has(entryId));
      const visibleIds = new Set(orderedEntryIds);
      const hidden = state.selectedEntryIds.filter((entryId) => !visibleIds.has(entryId));
      return { ...state, selectedEntryIds: [...visible, ...hidden] };
    }
    case 'deselectByMask': {
      if (action.matchingEntryIds.length === 0) return state;
      const deselected = new Set(action.matchingEntryIds);
      const remaining = state.selectedEntryIds.filter((entryId) => !deselected.has(entryId));
      const remainingIds = new Set(remaining);
      const visible = orderedEntryIds.filter((entryId) => remainingIds.has(entryId));
      const visibleIds = new Set(orderedEntryIds);
      const hidden = remaining.filter((entryId) => !visibleIds.has(entryId));
      return { ...state, selectedEntryIds: [...visible, ...hidden] };
    }
    case 'clear': {
      const { anchorEntryId: _anchorEntryId, baseSelectedEntryIds: _base, ...withoutMeta } = state;
      return { ...withoutMeta, selectedEntryIds: [] };
    }
    case 'prune': {
      const removed = new Set(action.removedEntryIds);
      return {
        selectedEntryIds: state.selectedEntryIds.filter((entryId) => !removed.has(entryId)),
        ...(state.cursorEntryId === undefined || removed.has(state.cursorEntryId)
          ? {}
          : { cursorEntryId: state.cursorEntryId }),
        ...(state.anchorEntryId === undefined || removed.has(state.anchorEntryId)
          ? {}
          : { anchorEntryId: state.anchorEntryId }),
      };
    }
  }
}

/**
 * Retrieves the directory entries that are currently selected.
 * Returns entries in the same order as the directory listing, not the selection order.
 */ export function getSelectedEntries(
  selection: SelectionState | undefined,
  entries: readonly EntrySummary[],
): readonly EntrySummary[] {
  if (selection === undefined || selection.selectedEntryIds.length === 0) {
    return [];
  }
  const idSet = new Set(selection.selectedEntryIds);
  return entries.filter((entry) => idSet.has(entry.id) === true);
}

/**
 * Retrieves the locations of the currently selected entries.
 * Equivalent to `getSelectedEntries(selection, entries).map(e => e.location)`.
 */ export function getSelectedEntryLocations(
  selection: SelectionState | undefined,
  entries: readonly EntrySummary[],
): readonly Location[] {
  return getSelectedEntries(selection, entries).map((entry) => entry.location);
}

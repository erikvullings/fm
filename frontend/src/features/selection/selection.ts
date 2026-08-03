import type { EntryId } from '../../models';

/** Stable-ID selection state for one pane. */
export interface SelectionState {
  readonly selectedEntryIds: readonly EntryId[];
  readonly cursorEntryId?: EntryId;
  readonly anchorEntryId?: EntryId;
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
  switch (action.type) {
    case 'moveCursor': {
      const index = clampedIndex(
        cursorIndex(state, orderedEntryIds) + action.offset,
        orderedEntryIds,
      );
      const entryId = index === undefined ? undefined : orderedEntryIds[index];
      return entryId === undefined
        ? state
        : { ...state, selectedEntryIds: [entryId], cursorEntryId: entryId, anchorEntryId: entryId };
    }
    case 'moveCursorTo': {
      const entryId = action.edge === 'first' ? orderedEntryIds[0] : orderedEntryIds.at(-1);
      return entryId === undefined
        ? state
        : { ...state, selectedEntryIds: [entryId], cursorEntryId: entryId, anchorEntryId: entryId };
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
      return {
        selectedEntryIds: orderedEntryIds.slice(rangeStart, rangeEnd + 1),
        ...(orderedEntryIds[nextIndex] === undefined
          ? {}
          : { cursorEntryId: orderedEntryIds[nextIndex] }),
        ...(anchorEntryId === undefined ? {} : { anchorEntryId }),
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
      return {
        selectedEntryIds: orderedEntryIds.slice(rangeStart, rangeEnd + 1),
        cursorEntryId: action.entryId,
        anchorEntryId,
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
    case 'clear': {
      const { anchorEntryId: _anchorEntryId, ...withoutAnchor } = state;
      return { ...withoutAnchor, selectedEntryIds: [] };
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

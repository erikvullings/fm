import type { TabId } from '../../models';

/** Wraps a cycling index by `direction` (+1/-1) around `length`, per spec §37 tab cycling. */
export function cycledTabIndex(currentIndex: number, length: number, direction: 1 | -1): number {
  if (length <= 0) return currentIndex;
  return (currentIndex + direction + length) % length;
}

/** Resolves the tab id for a 1-based "jump to tab N" shortcut; `undefined` if N is out of range. */
export function tabIdForJump(order: readonly TabId[], oneBasedIndex: number): TabId | undefined {
  return order[oneBasedIndex - 1];
}

/** Reinserts `draggedId` immediately before `targetId`, preserving every other tab's order. */
export function reorderedTabIds(
  order: readonly TabId[],
  draggedId: TabId,
  targetId: TabId,
): TabId[] {
  if (draggedId === targetId) return [...order];
  const withoutDragged = order.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) return [...order];
  return [...withoutDragged.slice(0, targetIndex), draggedId, ...withoutDragged.slice(targetIndex)];
}

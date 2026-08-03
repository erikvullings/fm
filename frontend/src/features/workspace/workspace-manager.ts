import type { WorkspaceId, WorkspaceSummary } from '../../models';

/** Deterministic, name-ordered listing for the workspace switcher (ties break on id). */
export function sortWorkspaceSummaries(
  summaries: readonly WorkspaceSummary[],
): readonly WorkspaceSummary[] {
  return [...summaries].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/**
 * Chooses the workspace that should become active once the current one is no
 * longer valid (deleted locally or by another session). `undefined` tells the
 * caller no persisted workspace remains, so it must create a fresh default.
 */
export function firstAvailableWorkspaceId(
  summaries: readonly WorkspaceSummary[],
): WorkspaceId | undefined {
  return summaries[0]?.id;
}

import type { EntrySummary, Location, OperationKind, RuntimeCapabilities } from '../../models';

export interface DropModifiers {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
}

export type DropValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** A directory row receives the drop; files and empty space resolve to the pane directory. */
export function resolveDropTarget(paneLocation: Location, row: EntrySummary | undefined): Location {
  return row?.kind === 'directory' ? row.location : paneLocation;
}

function isSameOrDescendant(source: Location, destination: Location): boolean {
  if (source.providerId !== destination.providerId) return false;
  try {
    const sourceUrl = new URL(source.uri);
    const destinationUrl = new URL(destination.uri);
    if (sourceUrl.origin !== destinationUrl.origin) return false;
    const root = sourceUrl.pathname.replace(/\/+$/u, '');
    const target = destinationUrl.pathname.replace(/\/+$/u, '');
    return target === root || target.startsWith(`${root}/`);
  } catch {
    return source.uri === destination.uri || destination.uri.startsWith(`${source.uri}/`);
  }
}

/** Validates before `dragover` is accepted, so invalid targets never appear droppable. */
export function validateDropTarget(
  sources: readonly Location[],
  target: Location | undefined,
  writable: boolean,
): DropValidation {
  if (sources.length === 0) return { ok: false, message: 'No files are being dragged.' };
  if (target === undefined) return { ok: false, message: 'The destination is unavailable.' };
  if (!writable) return { ok: false, message: 'The destination directory is read-only.' };
  if (sources.some((source) => isSameOrDescendant(source, target))) {
    return { ok: false, message: 'Cannot drop a location into itself or its subtree.' };
  }
  return { ok: true };
}

/** Default is move; Option on macOS and Control elsewhere requests a copy. */
export function operationForDrop(
  platform: RuntimeCapabilities['platform'],
  modifiers: DropModifiers,
): Extract<OperationKind, 'copy' | 'move'> {
  return platform === 'macos'
    ? modifiers.altKey
      ? 'copy'
      : 'move'
    : modifiers.ctrlKey
      ? 'copy'
      : 'move';
}

import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntryMetadata, EntrySummary } from '../../models';

/** Client surface required to lazily fetch detailed metadata for one entry. */
export type EntryMetadataClient = Pick<FileManagerClient, 'getEntryMetadata'>;

/** Metadata-panel state published as the cursor selection changes. */
export type EntryMetadataView =
  | { readonly state: 'idle' }
  | { readonly state: 'loading'; readonly entry: EntrySummary }
  | {
      readonly state: 'loaded';
      readonly entry: EntrySummary;
      readonly metadata: EntryMetadata;
    }
  | { readonly state: 'error'; readonly entry: EntrySummary; readonly message: string };

/** Dependencies kept outside the metadata loading module. */
export interface EntryMetadataLoaderOptions {
  readonly client: EntryMetadataClient;
  readonly update: (view: EntryMetadataView) => void;
}

/** Cancellable cursor-driven metadata operations. */
export interface EntryMetadataLoader {
  select(entry: EntrySummary | undefined): Promise<void>;
  dispose(): void;
}

interface ActiveRequest {
  readonly controller: AbortController;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load entry metadata';
}

/** Creates a lazy loader whose newest cursor selection exclusively owns the visible result. */
export function createEntryMetadataLoader(
  options: EntryMetadataLoaderOptions,
): EntryMetadataLoader {
  let activeRequest: ActiveRequest | undefined;
  let disposed = false;

  function cancelActive(): void {
    activeRequest?.controller.abort();
    activeRequest = undefined;
  }

  function isCurrent(request: ActiveRequest): boolean {
    return activeRequest === request && !request.controller.signal.aborted && !disposed;
  }

  return {
    select: async (entry) => {
      if (disposed) {
        return;
      }
      cancelActive();
      if (entry === undefined) {
        options.update({ state: 'idle' });
        return;
      }

      const request: ActiveRequest = { controller: new AbortController() };
      activeRequest = request;
      options.update({ state: 'loading', entry });

      try {
        const metadata = await options.client.getEntryMetadata(
          { entryId: entry.id, location: entry.location },
          request.controller.signal,
        );
        if (isCurrent(request)) {
          options.update({ state: 'loaded', entry, metadata });
        }
      } catch (error: unknown) {
        if (isCurrent(request)) {
          options.update({ state: 'error', entry, message: errorMessage(error) });
        }
      } finally {
        if (activeRequest === request) {
          activeRequest = undefined;
        }
      }
    },
    dispose: () => {
      disposed = true;
      cancelActive();
    },
  };
}

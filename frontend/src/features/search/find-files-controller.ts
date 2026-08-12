import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { Location, PaneId, WorkspaceProjection } from '../../models';
import type { NavigationController } from '../navigation/navigation';
import type { FindFilesSearchParams } from './find-files-dialog';

/** Context required by FindFilesController for state access and dependencies. */
export interface FindFilesControllerContext {
  // State getters
  getFindFilesOpen(): boolean;
  getFindFilesRoot(): Location | undefined;
  getFindFilesSearchId(): string | undefined;
  getFindFilesError(): string | undefined;
  getFindFilesGeneration(): number;
  getFindFilesRootsByLocationUri(): Map<string, Location>;
  getFindFilesQueriesByLocationUri(): Map<string, string>;
  getFindFilesParamsByLocationUri(): Map<string, FindFilesSearchParams>;

  // State setters
  setFindFilesOpen(open: boolean): void;
  setFindFilesRoot(root: Location | undefined): void;
  setFindFilesSearchId(searchId: string | undefined): void;
  setFindFilesError(error: string | undefined): void;
  setFindFilesGeneration(generation: number): void;

  // Dependencies
  getActiveDirectory(): { paneId: PaneId; location: Location } | undefined;
  getWorkspace(): WorkspaceProjection | undefined;
  getNavigation(): NavigationController;
  getClient(): FileManagerClient;
  getFocusPane(): ((paneId: PaneId) => void) | undefined;
  redraw(): void;
}

/** Controller interface for find-files operations. */
export interface FindFilesController {
  /**
   * Opens the filename search dialog at the active directory,
   * or reopens at the previous search's root if a search location is active.
   */
  openFindFiles(): void;

  /**
   * Closes the search dialog and cancels any in-flight search.
   */
  closeFindFiles(): void;

  /**
   * Closes the search dialog without cancelling the search now displayed in the active pane.
   */
  dismissFindFiles(): void;

  /**
   * Starts (or restarts) a search rooted at the dialog's current directory.
   */
  startFindFilesSearch(params: FindFilesSearchParams): void;

  /**
   * The active tab's current "show hidden files" setting, so a new search respects it.
   */
  activeShowHidden(paneId: PaneId): boolean;
}

/**
 * Factory function to create a FindFilesController.
 */
export function createFindFilesController(
  context: FindFilesControllerContext,
): FindFilesController {
  return {
    openFindFiles(): void {
      const active = context.getActiveDirectory();
      if (active === undefined) return;
      const root =
        context.getFindFilesRootsByLocationUri().get(active.location.uri) ?? active.location;
      context.setFindFilesRoot(root);
      context.setFindFilesOpen(true);
    },

    closeFindFiles(): void {
      const searchId = context.getFindFilesSearchId();
      if (searchId !== undefined) {
        void context
          .getClient()
          .cancelSearch(searchId)
          .catch(() => undefined);
      }
      context.setFindFilesGeneration(context.getFindFilesGeneration() + 1);
      context.setFindFilesOpen(false);
      context.setFindFilesRoot(undefined);
      context.setFindFilesSearchId(undefined);
      context.setFindFilesError(undefined);
    },

    dismissFindFiles(): void {
      context.setFindFilesOpen(false);
      context.setFindFilesRoot(undefined);
      context.setFindFilesError(undefined);
    },

    startFindFilesSearch(params: FindFilesSearchParams): void {
      const root = context.getFindFilesRoot();
      const workspace = context.getWorkspace();
      if (root === undefined || workspace === undefined) return;

      const searchId = context.getFindFilesSearchId();
      if (searchId !== undefined) {
        void context
          .getClient()
          .cancelSearch(searchId)
          .catch(() => undefined);
      }

      const nextGeneration = context.getFindFilesGeneration() + 1;
      context.setFindFilesGeneration(nextGeneration);
      const generation = nextGeneration;
      context.setFindFilesError(undefined);
      context.setFindFilesSearchId(undefined);

      const searchPaneId = context.getActiveDirectory()?.paneId ?? workspace.activePaneId;

      void context
        .getClient()
        .startSearch({
          query: params.filenameQuery,
          contentQuery: params.contentQuery,
          contentRegex: params.contentRegex,
          contentCaseSensitive: false,
          contentWholeWord: true,
          recurse: params.recurse,
          showHidden: searchPaneId === undefined ? false : this.activeShowHidden(searchPaneId),
          roots: [root],
          workspaceId: workspace.id,
        })
        .then((result) => {
          if (generation !== context.getFindFilesGeneration()) {
            void context
              .getClient()
              .cancelSearch(result.searchId)
              .catch(() => undefined);
            return;
          }
          context.setFindFilesSearchId(result.searchId);
          context.getFindFilesRootsByLocationUri().set(result.location.uri, root);
          context
            .getFindFilesQueriesByLocationUri()
            .set(result.location.uri, params.filenameQuery || JSON.stringify(params));
          context.getFindFilesParamsByLocationUri().set(result.location.uri, params);

          const paneId = context.getActiveDirectory()?.paneId ?? workspace?.activePaneId;
          if (paneId === undefined) return;

          this.dismissFindFiles();
          void context
            .getNavigation()
            .navigate(paneId, result.location)
            .then(() => {
              // Land keyboard focus in the pane so arrow keys move the cursor immediately,
              // matching the UX of navigating there by clicking (task 0089 follow-up).
              context.getFocusPane()?.(paneId);
              context.redraw();
            });
        })
        .catch((error: unknown) => {
          if (generation !== context.getFindFilesGeneration()) return;
          context.setFindFilesError(
            error instanceof Error ? error.message : 'Unable to start search',
          );
          context.redraw();
        });
    },

    activeShowHidden(paneId: PaneId): boolean {
      const workspace = context.getWorkspace();
      const pane = workspace?.panesById[paneId];
      const tab = pane === undefined ? undefined : pane.tabsById[pane.activeTabId];
      return tab?.view.showHidden ?? false;
    },
  };
}

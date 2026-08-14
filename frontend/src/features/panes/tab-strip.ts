import m, { type FactoryComponent } from 'mithril';
import { IconButton } from 'mithril-materialized';
import { heartIcon, heartPlusIcon, plusIcon, searchIcon } from '../../components/tabler-icons';
import { tooltip } from '../../components/tooltip';
import type { TabId } from '../../models';
import { reorderedTabIds } from './tab-navigation';

/** One entry in a pane's tab strip (spec §37). */
export interface PaneTab {
  readonly id: TabId;
  readonly title: string;
  /** Full path shown as the tab's tooltip. */
  readonly path: string;
  /** Canonical tab location URI used for scheme/provider-specific behaviour. */
  readonly locationUri?: string;
  /** Whether this tab is a `search://` results tab — shown with a search icon instead of a
   * `search:` text prefix in the tab strip (task 0089 follow-up). */
  readonly isSearchTab?: boolean;
}

export interface TabStripAttrs {
  readonly tabs: readonly PaneTab[];
  readonly activeTabId: TabId;
  readonly onSelectTab: (tabId: TabId) => void;
  readonly onCloseTab: (tabId: TabId) => void;
  readonly onNewTab: () => void;
  readonly onReorderTabs: (order: readonly TabId[]) => void;
  readonly onTabDragOver?: ((tabId: TabId, event: DragEvent) => boolean) | undefined;
  readonly onTabDrop?: ((tabId: TabId, event: DragEvent) => void) | undefined;
  /** Whether the favourites menu is currently open (controls aria-expanded). */
  readonly favouritesOpen: boolean;
  /** Whether the current location can be added as a new favourite (controls heart vs heart-plus). */
  readonly canAddFavourite: boolean;
  readonly onToggleFavourites: () => void;
}

/** Renders the pane tab bar — individual tabs with drag-to-reorder, new-tab and favourites buttons. */
export const TabStrip: FactoryComponent<TabStripAttrs> = () => {
  let draggedTabId: TabId | undefined;
  let dropTargetTabId: TabId | undefined;

  return {
    view: ({ attrs }) =>
      m('.fm-pane-tabs', { role: 'tablist', 'aria-label': 'Pane tabs' }, [
        ...attrs.tabs.map((tab) =>
          m(
            '.fm-pane-tab',
            {
              key: tab.id,
              role: 'tab',
              tabindex: 0,
              draggable: true,
              title: tab.path,
              'aria-selected': tab.id === attrs.activeTabId ? 'true' : 'false',
              onclick: (event: MouseEvent) => {
                event.stopPropagation();
                attrs.onSelectTab(tab.id);
              },
              onkeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  attrs.onSelectTab(tab.id);
                }
              },
              ondragstart: (event: DragEvent) => {
                draggedTabId = tab.id;
                event.dataTransfer?.setData('text/plain', tab.id);
              },
              ondragover: (event: DragEvent) => {
                const accepted = attrs.onTabDragOver?.(tab.id, event) === true;
                if (draggedTabId !== undefined || accepted) {
                  event.preventDefault();
                  if (draggedTabId === undefined && accepted) dropTargetTabId = tab.id;
                }
              },
              ondragleave: () => {
                if (dropTargetTabId === tab.id) dropTargetTabId = undefined;
              },
              ondrop: (event: DragEvent) => {
                event.preventDefault();
                if (draggedTabId === undefined) {
                  dropTargetTabId = undefined;
                  attrs.onTabDrop?.(tab.id, event);
                  return;
                }
                const sourceId =
                  draggedTabId ?? (event.dataTransfer?.getData('text/plain') as TabId | '');
                draggedTabId = undefined;
                if (sourceId !== undefined && sourceId !== '' && sourceId !== tab.id) {
                  attrs.onReorderTabs(
                    reorderedTabIds(
                      attrs.tabs.map((candidate) => candidate.id),
                      sourceId,
                      tab.id,
                    ),
                  );
                }
              },
              ondragend: () => {
                draggedTabId = undefined;
                dropTargetTabId = undefined;
              },
              class: [
                dropTargetTabId === tab.id ? 'fm-drop-target' : '',
                attrs.tabs.length === 1 ? 'fm-pane-tab-only' : '',
              ]
                .filter((name) => name !== '')
                .join(' '),
            },
            [
              m(
                'span.fm-pane-tab-title',
                tab.isSearchTab === true
                  ? [searchIcon({ size: 14, className: 'fm-pane-tab-search-icon' }), tab.title]
                  : tab.title,
              ),
              m(
                'button.fm-pane-tab-close',
                {
                  type: 'button',
                  'aria-label': `Close ${tab.title}`,
                  tabindex: -1,
                  onclick: (event: MouseEvent) => {
                    event.stopPropagation();
                    attrs.onCloseTab(tab.id);
                  },
                },
                '×',
              ),
            ],
          ),
        ),
        tooltip(
          'New tab',
          m(
            IconButton,
            {
              className: 'fm-pane-tab-new',
              'aria-label': 'New tab',
              onclick: () => attrs.onNewTab(),
            },
            plusIcon(),
          ),
          { key: '__new-tab__' },
        ),
        tooltip(
          'Favourites',
          m(
            IconButton,
            {
              className: 'fm-pane-tab-favourites',
              'aria-label': 'Favourites',
              'aria-expanded': String(attrs.favouritesOpen),
              onclick: () => attrs.onToggleFavourites(),
            },
            attrs.canAddFavourite ? heartPlusIcon() : heartIcon(),
          ),
          { key: '__favourites__' },
        ),
      ]),
  };
};

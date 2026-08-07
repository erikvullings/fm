import m, { type FactoryComponent } from 'mithril';
import { closeIcon } from '../../components/tabler-icons';
import type { EntrySummary } from '../../models';
import type {
  FileViewerSearchState,
  FileViewerState,
  FileViewerTextContent,
} from './file-viewer-controller';
import {
  highlightToHtml,
  languageForExtension,
  wrapRangeInHighlightMark,
} from './syntax-highlighting';
import './file-viewer.css';

/** Presentational Lister-style large-file viewer (task 0088); all state/async work lives in
 * `createFileViewerController` - this component only renders `attrs.state` and forwards intent
 * via callbacks, per this repo's convention of keeping application logic out of components. */
export interface FileViewerAttrs {
  readonly state: FileViewerState;
  readonly onLoadMore: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSearchOptionChange: (
    patch: Partial<Pick<FileViewerSearchState, 'regex' | 'caseSensitive' | 'wholeWord'>>,
  ) => void;
  readonly onRunSearch: () => void;
  readonly onNextMatch: () => void;
  readonly onPreviousMatch: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetZoom: () => void;
  readonly onClose: () => void;
}

const LOAD_MORE_THRESHOLD_PX = 200;

/** Tracks the last search match scrolled into view, per viewer instance, so a match already on
 * screen (or an unrelated re-render, e.g. typing in the search box) doesn't re-trigger a scroll. */
interface HighlightScrollState {
  lastKey: string | undefined;
}

function scrollHighlightIntoViewIfNeeded(
  element: HTMLElement,
  highlightKey: string | undefined,
  scrollState: HighlightScrollState,
): void {
  if (highlightKey === undefined || highlightKey === scrollState.lastKey) return;
  scrollState.lastKey = highlightKey;
  const container = element.closest('.fm-file-viewer-body-text');
  if (!(container instanceof HTMLElement)) return;
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const alreadyVisible =
    elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
  if (!alreadyVisible) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

function renderSearchBar(
  attrs: FileViewerAttrs,
  search: FileViewerSearchState | undefined,
): m.Children {
  const query = search?.query ?? '';
  const matches = search?.matches ?? [];
  const currentMatchIndex = search?.currentMatchIndex;
  return m('.fm-file-viewer-search', [
    m('input.fm-file-viewer-search-input', {
      type: 'text',
      placeholder: 'Search this file…',
      value: query,
      'aria-label': 'Search this file',
      oninput: (event: InputEvent) =>
        attrs.onSearchQueryChange((event.currentTarget as HTMLInputElement).value),
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          attrs.onRunSearch();
        }
      },
    }),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: 'Match case',
        'aria-pressed': search?.caseSensitive === true ? 'true' : 'false',
        onclick: () =>
          attrs.onSearchOptionChange({ caseSensitive: search?.caseSensitive !== true }),
      },
      'Aa',
    ),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: 'Match whole word',
        'aria-pressed': search?.wholeWord === true ? 'true' : 'false',
        onclick: () => attrs.onSearchOptionChange({ wholeWord: search?.wholeWord !== true }),
      },
      'Ab',
    ),
    m(
      'button.fm-file-viewer-search-toggle',
      {
        type: 'button',
        title: 'Use regular expression',
        'aria-pressed': search?.regex === true ? 'true' : 'false',
        onclick: () => attrs.onSearchOptionChange({ regex: search?.regex !== true }),
      },
      '.*',
    ),
    m(
      'span.fm-file-viewer-search-count',
      search === undefined
        ? undefined
        : search.searching
          ? 'Searching…'
          : search.error !== undefined
            ? search.error
            : matches.length === 0
              ? query.trim() === ''
                ? undefined
                : 'No results'
              : `${(currentMatchIndex ?? 0) + 1} of ${matches.length}${search.truncated ? '+' : ''}`,
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: 'Previous match',
        disabled: matches.length === 0,
        onclick: attrs.onPreviousMatch,
      },
      '▲',
    ),
    m(
      'button.fm-file-viewer-search-nav',
      {
        type: 'button',
        title: 'Next match',
        disabled: matches.length === 0,
        onclick: attrs.onNextMatch,
      },
      '▼',
    ),
  ]);
}

/** Re-renders the `pre.fm-file-viewer-text` element imperatively (syntax highlighting and the
 * search-match `<mark>` are both DOM-tree operations, not plain vdom children - see
 * `syntax-highlighting.ts`), then re-runs the scroll-into-view check for the active match. */
function updateHighlightedTextBody(
  element: HTMLElement,
  content: FileViewerTextContent,
  entry: EntrySummary,
  scrollState: HighlightScrollState,
): void {
  const language = languageForExtension(entry.extension);
  element.innerHTML = highlightToHtml(content.text, language);
  element.classList.toggle('hljs', language !== undefined);

  const start = content.highlightOffset;
  const end =
    start === undefined || content.highlightLength === undefined
      ? undefined
      : start + content.highlightLength;
  if (start !== undefined && end !== undefined && start >= 0 && end <= content.text.length) {
    wrapRangeInHighlightMark(element, start, end);
  }
  const mark = element.querySelector('.fm-file-viewer-highlight');
  if (mark instanceof HTMLElement) {
    scrollHighlightIntoViewIfNeeded(
      mark,
      `${content.highlightOffset}:${content.highlightLength}`,
      scrollState,
    );
  }
}

function renderTextBody(
  attrs: FileViewerAttrs,
  state: Extract<FileViewerState, { status: 'ready' }>,
  highlightScrollState: HighlightScrollState,
): m.Children {
  const content = state.content;
  if (content.kind !== 'text') return undefined;
  const update = (element: HTMLElement) =>
    updateHighlightedTextBody(element, content, state.entry, highlightScrollState);
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-text',
    {
      onscroll: (event: Event) => {
        const target = event.currentTarget as HTMLElement;
        if (
          !content.atEnd &&
          !content.loadingMore &&
          target.scrollTop + target.clientHeight >= target.scrollHeight - LOAD_MORE_THRESHOLD_PX
        ) {
          attrs.onLoadMore();
        }
      },
    },
    [
      m('pre.fm-file-viewer-text', {
        oncreate: (vnode: m.VnodeDOM) => update(vnode.dom as HTMLElement),
        onupdate: (vnode: m.VnodeDOM) => update(vnode.dom as HTMLElement),
      }),
      content.loadingMore ? m('.fm-file-viewer-loading-more', 'Loading more…') : undefined,
    ],
  );
}

function renderImageBody(
  attrs: FileViewerAttrs,
  state: Extract<FileViewerState, { status: 'ready' }>,
): m.Children {
  const content = state.content;
  if (content.kind !== 'image') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-image',
    {
      onwheel: (event: WheelEvent) => {
        event.preventDefault();
        if (event.deltaY < 0) attrs.onZoomIn();
        else if (event.deltaY > 0) attrs.onZoomOut();
      },
    },
    m('img', {
      src: content.dataUri,
      alt: state.entry.name,
      class: content.fitToContainer ? 'fm-file-viewer-image-fit' : undefined,
      style: content.fitToContainer ? undefined : { width: `${content.zoom * 100}%` },
    }),
  );
}

function renderAudioBody(state: Extract<FileViewerState, { status: 'ready' }>): m.Children {
  const content = state.content;
  if (content.kind !== 'audio') return undefined;
  return m(
    '.fm-file-viewer-body.fm-file-viewer-body-audio',
    m('audio', {
      controls: true,
      autoplay: false,
      src: content.dataUri,
      'aria-label': state.entry.name,
    }),
  );
}

export const FileViewer: FactoryComponent<FileViewerAttrs> = () => {
  const highlightScrollState: HighlightScrollState = { lastKey: undefined };
  return {
    view: ({ attrs }) => {
      const state = attrs.state;
      const search =
        state.status === 'ready' && state.content.kind === 'text' ? state.search : undefined;
      return m('section.fm-file-viewer', { 'aria-label': `Viewing ${state.entry.name}` }, [
        m('.fm-file-viewer-header', [
          m('strong.fm-file-viewer-title', state.entry.name),
          state.status === 'ready' && state.content.kind === 'image'
            ? m('.fm-file-viewer-zoom-controls', [
                m('button', { type: 'button', title: 'Zoom out', onclick: attrs.onZoomOut }, '−'),
                m(
                  'span.fm-file-viewer-zoom-level',
                  state.content.fitToContainer ? 'Fit' : `${Math.round(state.content.zoom * 100)}%`,
                ),
                m('button', { type: 'button', title: 'Zoom in', onclick: attrs.onZoomIn }, '+'),
                m(
                  'button',
                  { type: 'button', title: 'Fit to window', onclick: attrs.onResetZoom },
                  'Fit',
                ),
              ])
            : undefined,
          m(
            'button.fm-file-viewer-close',
            { type: 'button', 'aria-label': 'Close viewer', onclick: attrs.onClose },
            closeIcon({ size: 13 }),
          ),
        ]),
        state.status === 'ready' && state.content.kind === 'text'
          ? renderSearchBar(attrs, search)
          : undefined,
        state.status === 'loading'
          ? m('.fm-file-viewer-body', m('span', 'Loading…'))
          : state.status === 'unsupported'
            ? m('.fm-file-viewer-body', m('span', 'Preview not available for this file.'))
            : state.status === 'error'
              ? m('.fm-file-viewer-body', m('span', state.message))
              : state.content.kind === 'text'
                ? renderTextBody(attrs, state, highlightScrollState)
                : state.content.kind === 'audio'
                  ? renderAudioBody(state)
                  : renderImageBody(attrs, state),
      ]);
    },
  };
};

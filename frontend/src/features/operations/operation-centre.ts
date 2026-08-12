import m, { type Component } from 'mithril';

import type { Operation, OperationId } from '../../models';
import type { OperationCentreState } from './operation-state';

export interface OperationCentreAttrs {
  state: OperationCentreState;
  onCancel: (operationId: OperationId) => void;
  onPause: (operationId: OperationId) => void;
  onResume: (operationId: OperationId) => void;
  onDismiss: (operationId: OperationId) => void;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(value % 1_024 === 0 ? 0 : 1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

/** Guards against `null` slipping through instead of an omitted optional field. */
function hasValue<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function currentEntryName(operation: Operation): string | undefined {
  const uri = operation.progress.currentEntry?.location.uri;
  if (uri === undefined) return undefined;
  return entryNameFromUri(uri);
}

function entryNameFromUri(uri: string): string {
  const segment = uri.split('/').at(-1);
  return segment === undefined ? uri : decodeURIComponent(segment);
}

function completedWithWarningsResult(operation: Operation): string {
  const warningCount = operation.errors?.length ?? 0;
  if (warningCount > 0) {
    return `Completed with ${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}.`;
  }
  return operation.result?.message ?? 'Completed with warnings.';
}

/** Search operations show a running match count instead of the current-entry filename - the
 * filename being scanned right now is rarely the interesting bit (and looks like a bug report
 * of its own when it lands on some unrelated file deep in `node_modules`), whereas "N files
 * found" directly answers "is this working / how many results so far". */
function searchProgressSummary(operation: Operation): string {
  const count = operation.progress.completedItems;
  return `${count} ${count === 1 ? 'file' : 'files'} found…`;
}

function cancelledResult(operation: Operation): string {
  const { completedItems, totalItems, completedBytes, totalBytes } = operation.progress;
  const items = `${completedItems}${hasValue(totalItems) ? ` / ${totalItems}` : ''}`;
  if (operation.kind === 'search') {
    return operation.result?.message ?? `Cancelled after finding ${items} files.`;
  }
  const bytes = `${formatBytes(completedBytes)}${
    hasValue(totalBytes) ? ` / ${formatBytes(totalBytes)}` : ''
  }`;
  return operation.result?.message ?? `Cancelled after ${items} items (${bytes}).`;
}

function button(label: string, action: string, onclick: () => void) {
  return m('button', { type: 'button', 'data-action': action, onclick }, label);
}

/** Compact event-driven queue shown below the workspace panes. */
export const OperationCentre: Component<OperationCentreAttrs> = {
  view: ({ attrs }) => {
    const operations = Object.values(attrs.state.byId)
      .filter((operation): operation is Operation => operation !== undefined)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (operations.length === 0) {
      return null;
    }
    return m(
      '.fm-operation-centre',
      { 'aria-label': 'Operation centre' },
      operations.map((operation) => {
        const progress = operation.progress;
        const failure = attrs.state.failuresById[operation.id];
        const warnings = operation.errors ?? [];
        const isSearch = operation.kind === 'search';
        const terminal =
          operation.state === 'completed' ||
          operation.state === 'completedWithWarnings' ||
          operation.state === 'failed' ||
          operation.state === 'cancelled' ||
          operation.state === 'interrupted';
        return m('article.fm-operation', { 'data-operation-id': operation.id }, [
          m('.fm-operation-summary', [
            m('strong', `${operation.kind ?? 'operation'} · ${operation.state}`),
            operation.queuePosition === undefined
              ? undefined
              : m('span', `Queue position ${operation.queuePosition}`),
            isSearch && operation.state === 'running'
              ? m('span', searchProgressSummary(operation))
              : undefined,
            !isSearch && currentEntryName(operation) !== undefined
              ? m('span', currentEntryName(operation))
              : undefined,
            isSearch
              ? undefined
              : m(
                  'span',
                  `${progress.completedItems}${hasValue(progress.totalItems) ? ` / ${progress.totalItems}` : ''} items`,
                ),
            isSearch
              ? undefined
              : m(
                  'span',
                  `${formatBytes(progress.completedBytes)}${hasValue(progress.totalBytes) ? ` / ${formatBytes(progress.totalBytes)}` : ''}`,
                ),
            hasValue(progress.bytesPerSecond) && !isSearch
              ? m('span', `${formatBytes(progress.bytesPerSecond)}/s`)
              : undefined,
          ]),
          hasValue(progress.totalBytes)
            ? m('progress', {
                value: progress.completedBytes,
                max: Math.max(progress.totalBytes, 1),
                'aria-label': `${operation.kind ?? 'operation'} progress`,
              })
            : undefined,
          operation.state !== 'completed' && operation.state !== 'completedWithWarnings'
            ? operation.state === 'cancelled'
              ? m('.fm-operation-result', cancelledResult(operation))
              : undefined
            : m(
                '.fm-operation-result',
                operation.state === 'completedWithWarnings'
                  ? completedWithWarningsResult(operation)
                  : (operation.result?.message ??
                      (isSearch
                        ? `Found ${operation.progress.completedItems} files.`
                        : `Completed ${operation.progress.completedItems} items (${formatBytes(operation.progress.completedBytes)}).`)),
              ),
          operation.state !== 'completedWithWarnings' || warnings.length === 0
            ? undefined
            : m('.fm-operation-warning', [
                m('details', [
                  m('summary', warnings.length === 1 ? 'Show warning' : 'Show warnings'),
                  m(
                    'ul',
                    warnings.map((warning) =>
                      m(
                        'li',
                        `${entryNameFromUri(warning.entry.location.uri)}: ${warning.message}`,
                      ),
                    ),
                  ),
                ]),
              ]),
          failure === undefined
            ? undefined
            : m('.fm-operation-failure', [
                m('span', failure.message),
                m('details', [
                  m('summary', 'Details'),
                  m('pre', JSON.stringify(failure.details ?? { code: failure.code }, null, 2)),
                ]),
              ]),
          m('.fm-operation-controls', [
            operation.state === 'queued' ||
            operation.state === 'planning' ||
            operation.state === 'running'
              ? button('Cancel', 'cancel', () => attrs.onCancel(operation.id))
              : undefined,
            operation.state === 'running'
              ? button('Pause', 'pause', () => attrs.onPause(operation.id))
              : undefined,
            operation.state === 'paused'
              ? button('Resume', 'resume', () => attrs.onResume(operation.id))
              : undefined,
            terminal
              ? button('Dismiss', 'dismiss', () => attrs.onDismiss(operation.id))
              : undefined,
          ]),
        ]);
      }),
    );
  },
};

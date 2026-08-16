import m, { type FactoryComponent } from 'mithril';

import {
  type ChecksumAlgorithm,
  type ChecksumEntry,
  checksumAlgorithmLabel,
  type VerificationReport,
  type VerificationStatus,
} from '../../models';

export interface ChecksumResultsViewAttrs {
  readonly algorithms: readonly ChecksumAlgorithm[];
  readonly entries: readonly ChecksumEntry[];
  readonly totalEntries: number;
  readonly isComplete: boolean;
  readonly isCancelled: boolean;
  readonly verification?: VerificationReport;
  readonly error?: string;
  readonly onCopy: (algorithm: ChecksumAlgorithm) => void;
  readonly onSave: (algorithm: ChecksumAlgorithm) => void;
  readonly onVerify: (content: string) => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  match: 'Match',
  mismatch: 'Mismatch',
  missing: 'Missing',
};

/** Shortens a digest for the table while keeping both ends recognisable. */
function abbreviate(digest: string): string {
  return digest.length <= 24 ? digest : `${digest.slice(0, 12)}…${digest.slice(-8)}`;
}

function progressLabel(attrs: ChecksumResultsViewAttrs): string {
  if (attrs.isCancelled) return `Cancelled after ${attrs.entries.length} of ${attrs.totalEntries}`;
  if (attrs.isComplete) return `${attrs.entries.length} of ${attrs.totalEntries} hashed`;
  return `Hashing ${attrs.entries.length} of ${attrs.totalEntries}…`;
}

/**
 * Presents a checksum job's per-entry results with copy, save-to-file and
 * verify-against-file affordances (spec §18, task 0077).
 *
 * Saving and verifying deliberately go through the caller: this view only
 * asks for the rendered text, so file writing stays on the one audited path
 * (spec §35).
 */
export const ChecksumResultsView: FactoryComponent<ChecksumResultsViewAttrs> = () => {
  let selectedAlgorithm: ChecksumAlgorithm | undefined;
  let verifyText = '';

  return {
    view: ({ attrs }) => {
      const algorithm = selectedAlgorithm ?? attrs.algorithms[0];
      return m('section.checksum-results', { 'aria-label': 'Checksum results' }, [
        m('header.checksum-results__header', [
          m('h2', 'Checksums'),
          m('span.checksum-results__progress', progressLabel(attrs)),
          !attrs.isComplete &&
            m(
              'button.checksum-results__cancel',
              { type: 'button', onclick: () => attrs.onCancel() },
              'Cancel',
            ),
          m(
            'button.checksum-results__close',
            {
              type: 'button',
              'aria-label': 'Close checksum results',
              onclick: () => attrs.onClose(),
            },
            'Close',
          ),
        ]),

        attrs.error !== undefined && m('p.checksum-results__error', { role: 'alert' }, attrs.error),

        attrs.algorithms.length > 1 &&
          m('label.checksum-results__algorithm', [
            'Algorithm for copy, save and verify: ',
            m(
              'select',
              {
                value: algorithm,
                onchange: (event: Event) => {
                  selectedAlgorithm = (event.target as HTMLSelectElement)
                    .value as ChecksumAlgorithm;
                },
              },
              attrs.algorithms.map((option) =>
                m('option', { value: option }, checksumAlgorithmLabel(option)),
              ),
            ),
          ]),

        m('div.checksum-results__actions', [
          m(
            'button',
            {
              type: 'button',
              disabled: algorithm === undefined || attrs.entries.length === 0,
              onclick: () => algorithm !== undefined && attrs.onCopy(algorithm),
            },
            'Copy',
          ),
          m(
            'button',
            {
              type: 'button',
              disabled: algorithm === undefined || attrs.entries.length === 0,
              onclick: () => algorithm !== undefined && attrs.onSave(algorithm),
            },
            'Save checksum file',
          ),
        ]),

        m('table.checksum-results__table', [
          m('thead', m('tr', [m('th', 'File'), m('th', 'Size'), m('th', 'Digest')])),
          m(
            'tbody',
            attrs.entries.map((entry) =>
              m('tr', { key: entry.location.uri }, [
                m('td', entry.relativePath),
                m('td', `${entry.size} B`),
                m(
                  'td.checksum-results__digest',
                  entry.error !== undefined
                    ? m('span.checksum-results__entry-error', entry.error)
                    : m(
                        'code',
                        {
                          title: algorithm === undefined ? '' : (entry.checksums[algorithm] ?? ''),
                        },
                        algorithm === undefined
                          ? ''
                          : abbreviate(entry.checksums[algorithm] ?? '—'),
                      ),
                ),
              ]),
            ),
          ),
        ]),

        m('div.checksum-results__verify', [
          m('h3', 'Verify against a checksum file'),
          m('textarea.checksum-results__verify-input', {
            'aria-label': 'Checksum file contents',
            rows: 4,
            placeholder: '<digest>  <path>',
            value: verifyText,
            oninput: (event: Event) => {
              verifyText = (event.target as HTMLTextAreaElement).value;
            },
          }),
          m(
            'button',
            {
              type: 'button',
              disabled: verifyText.trim() === '',
              onclick: () => attrs.onVerify(verifyText),
            },
            'Verify',
          ),
          attrs.verification !== undefined &&
            m('div.checksum-results__verification', [
              m(
                'p.checksum-results__verification-summary',
                `${attrs.verification.matched} matched, ${attrs.verification.mismatched} mismatched, ${attrs.verification.missing} missing`,
              ),
              m(
                'ul',
                attrs.verification.results.map((result) =>
                  m(
                    'li',
                    {
                      key: result.path,
                      class: `checksum-results__verification--${result.status}`,
                    },
                    `${result.path}: ${VERIFICATION_LABEL[result.status]}`,
                  ),
                ),
              ),
            ]),
        ]),
      ]);
    },
  };
};

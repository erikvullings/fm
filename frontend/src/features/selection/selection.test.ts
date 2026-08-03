import { describe, expect, it } from 'vitest';

import type { EntryId } from '../../models';
import { emptySelection, reduceSelection, type SelectionState } from './selection';

const ids = (...values: string[]): readonly EntryId[] => values;

describe('selection reducer', () => {
  it('moves the cursor and selects the new row', () => {
    expect(
      reduceSelection(
        { ...emptySelection, selectedEntryIds: ['b'], cursorEntryId: 'b' },
        { type: 'moveCursor', offset: 1 },
        ids('a', 'b', 'c'),
      ),
    ).toEqual({ selectedEntryIds: ['c'], cursorEntryId: 'c', anchorEntryId: 'c' });
  });

  it('moves by a page and clamps at the list boundary', () => {
    expect(
      reduceSelection(
        { ...emptySelection, cursorEntryId: 'b' },
        { type: 'moveCursor', offset: 20 },
        ids('a', 'b', 'c'),
      ).cursorEntryId,
    ).toBe('c');
  });

  it('moves to the first or last entry', () => {
    const first = reduceSelection(
      { ...emptySelection, cursorEntryId: 'b' },
      { type: 'moveCursorTo', edge: 'first' },
      ids('a', 'b', 'c'),
    );
    expect(first.cursorEntryId).toBe('a');
    expect(
      reduceSelection(first, { type: 'moveCursorTo', edge: 'last' }, ids('a', 'b', 'c'))
        .cursorEntryId,
    ).toBe('c');
  });

  it('selects one entry and establishes a range anchor', () => {
    expect(
      reduceSelection(emptySelection, { type: 'selectOnly', entryId: 'b' }, ids('a', 'b', 'c')),
    ).toEqual({
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    });
  });

  it('toggles entries into and out of a discontinuous selection', () => {
    const selected = reduceSelection(
      emptySelection,
      { type: 'toggle', entryId: 'a' },
      ids('a', 'b', 'c'),
    );
    const discontinuous = reduceSelection(
      selected,
      { type: 'toggle', entryId: 'c' },
      ids('a', 'b', 'c'),
    );
    expect(discontinuous.selectedEntryIds).toEqual(['a', 'c']);
    expect(
      reduceSelection(discontinuous, { type: 'toggle', entryId: 'a' }, ids('a', 'b', 'c'))
        .selectedEntryIds,
    ).toEqual(['c']);
  });

  it('extends a range from its stable anchor across a sort change', () => {
    const initial: SelectionState = {
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    };
    const extended = reduceSelection(
      initial,
      { type: 'extendRange', offset: 1 },
      ids('a', 'b', 'c', 'd'),
    );
    expect(extended.selectedEntryIds).toEqual(['b', 'c']);

    expect(
      reduceSelection(extended, { type: 'extendRange', offset: -1 }, ids('d', 'b', 'a', 'c')),
    ).toEqual({
      selectedEntryIds: ['b', 'a'],
      cursorEntryId: 'a',
      anchorEntryId: 'b',
    });
  });

  it('extends a range to a clicked entry and keeps the anchor when clicking back and forth', () => {
    const initial: SelectionState = {
      selectedEntryIds: ['b'],
      cursorEntryId: 'b',
      anchorEntryId: 'b',
    };
    const extended = reduceSelection(
      initial,
      { type: 'extendRangeTo', entryId: 'd' },
      ids('a', 'b', 'c', 'd'),
    );
    expect(extended).toEqual({
      selectedEntryIds: ['b', 'c', 'd'],
      cursorEntryId: 'd',
      anchorEntryId: 'b',
    });

    expect(
      reduceSelection(extended, { type: 'extendRangeTo', entryId: 'a' }, ids('a', 'b', 'c', 'd')),
    ).toEqual({
      selectedEntryIds: ['a', 'b'],
      cursorEntryId: 'a',
      anchorEntryId: 'b',
    });
  });

  it('selects all and inverts the current visible entries', () => {
    const all = reduceSelection(emptySelection, { type: 'selectAll' }, ids('a', 'b', 'c'));
    expect(all.selectedEntryIds).toEqual(['a', 'b', 'c']);
    expect(
      reduceSelection(
        { ...all, selectedEntryIds: ['a', 'c'] },
        { type: 'invert' },
        ids('a', 'b', 'c'),
      ).selectedEntryIds,
    ).toEqual(['b']);
  });

  it('clears selection without moving the cursor', () => {
    expect(
      reduceSelection(
        { selectedEntryIds: ['a'], cursorEntryId: 'a', anchorEntryId: 'a' },
        { type: 'clear' },
        ids('a'),
      ),
    ).toEqual({ selectedEntryIds: [], cursorEntryId: 'a' });
  });

  it('keeps hidden selected ids across filtering and pruning only removes delta ids', () => {
    const state: SelectionState = {
      selectedEntryIds: ['hidden', 'visible', 'removed'],
      cursorEntryId: 'removed',
      anchorEntryId: 'hidden',
    };
    const filtered = reduceSelection(state, { type: 'moveCursor', offset: 1 }, ids('visible'));
    expect(filtered.selectedEntryIds).toEqual(['visible']);

    expect(
      reduceSelection(filtered, { type: 'prune', removedEntryIds: ids('removed') }, ids('visible')),
    ).toEqual({
      selectedEntryIds: ['visible'],
      cursorEntryId: 'visible',
      anchorEntryId: 'visible',
    });
  });
});

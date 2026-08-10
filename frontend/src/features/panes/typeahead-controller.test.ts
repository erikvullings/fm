import { describe, expect, it, vi } from 'vitest';
import type { EntryId, EntrySummary } from '../../models';
import { createTypeaheadController } from './typeahead-controller';

function makeEntry(id: string, name: string): EntrySummary {
  return {
    id: id as EntryId,
    name,
    kind: 'file',
    size: 0,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
    location: { providerId: 'file', uri: `file:///test/${name}` },
  };
}

const entries = [
  makeEntry('alpha', 'alpha.txt'),
  makeEntry('beta', 'beta.txt'),
  makeEntry('document', 'document.pdf'),
  makeEntry('gamma', 'gamma.txt'),
];

describe('createTypeaheadController', () => {
  it('starts with no active prefix', () => {
    const ctrl = createTypeaheadController(() => undefined);
    expect(ctrl.prefix).toBeUndefined();
    expect(ctrl.hasError).toBe(false);
  });

  it('returns a selectOnly action when a character matches', () => {
    const ctrl = createTypeaheadController(() => undefined);
    const action = ctrl.handleChar('d', entries, 1000);
    expect(action).toEqual({ type: 'selectOnly', entryId: 'document' });
    expect(ctrl.prefix).toBe('d');
  });

  it('accumulates characters into a prefix', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('d', entries, 1000);
    ctrl.handleChar('o', entries, 1001);
    const action = ctrl.handleChar('c', entries, 1002);
    expect(ctrl.prefix).toBe('doc');
    expect(action).toEqual({ type: 'selectOnly', entryId: 'document' });
  });

  it('returns undefined and sets hasError when no match is found', () => {
    vi.useFakeTimers();
    const onRedraw = vi.fn();
    const ctrl = createTypeaheadController(onRedraw);
    const action = ctrl.handleChar('z', entries, 1000);
    expect(action).toBeUndefined();
    expect(ctrl.hasError).toBe(true);
    vi.useRealTimers();
  });

  it('clears hasError after the flash timeout and calls onRedraw', () => {
    vi.useFakeTimers();
    const onRedraw = vi.fn();
    const ctrl = createTypeaheadController(onRedraw);
    ctrl.handleChar('z', entries, 1000);
    expect(ctrl.hasError).toBe(true);
    vi.advanceTimersByTime(400);
    expect(ctrl.hasError).toBe(false);
    expect(onRedraw).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('handleBackspace trims the last character from the prefix', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('d', entries, 1000);
    ctrl.handleChar('o', entries, 1001);
    expect(ctrl.prefix).toBe('do');
    const consumed = ctrl.handleBackspace();
    expect(consumed).toBe(true);
    expect(ctrl.prefix).toBe('d');
  });

  it('handleBackspace clears the prefix when it reaches one character', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('d', entries, 1000);
    ctrl.handleBackspace();
    expect(ctrl.prefix).toBeUndefined();
  });

  it('handleBackspace returns false when no typeahead is active', () => {
    const ctrl = createTypeaheadController(() => undefined);
    expect(ctrl.handleBackspace()).toBe(false);
  });

  it('reset clears all state', () => {
    vi.useFakeTimers();
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('z', entries, 1000); // sets error
    ctrl.reset();
    expect(ctrl.prefix).toBeUndefined();
    expect(ctrl.hasError).toBe(false);
    vi.useRealTimers();
  });

  it('moveWithinMatches returns false when no typeahead is active', () => {
    const ctrl = createTypeaheadController(() => undefined);
    const result = ctrl.moveWithinMatches(entries, undefined, 1, undefined, false);
    expect(result).toBe(false);
  });

  it('moveWithinMatches navigates forward within matches', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('a', entries, 1000); // matches alpha, beta, gamma
    const cursor = entries[0] as EntrySummary; // alpha
    const result = ctrl.moveWithinMatches(entries, cursor, 1, undefined, false);
    expect(result).toEqual({ type: 'setCursor', entryId: 'beta' });
  });

  it('moveWithinMatches navigates to first match with edge="first"', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('a', entries, 1000); // matches alpha, beta, gamma
    const cursor = entries[3] as EntrySummary; // gamma
    const result = ctrl.moveWithinMatches(entries, cursor, 0, 'first', false);
    expect(result).toEqual({ type: 'setCursor', entryId: 'alpha' });
  });

  it('moveWithinMatches navigates to last match with edge="last"', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('a', entries, 1000); // matches alpha, beta, gamma
    const cursor = entries[0] as EntrySummary; // alpha
    const result = ctrl.moveWithinMatches(entries, cursor, 0, 'last', false);
    expect(result).toEqual({ type: 'setCursor', entryId: 'gamma' });
  });

  it('moveWithinMatches returns an extendRange action when extend=true', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('a', entries, 1000); // matches alpha (0), beta (1), gamma (3)
    const cursor = entries[0] as EntrySummary; // alpha at index 0
    const result = ctrl.moveWithinMatches(entries, cursor, 1, undefined, true);
    // beta is at entries index 1, alpha is at entries index 0, offset = 1-0 = 1
    expect(result).toEqual({ type: 'extendRange', offset: 1 });
  });

  it('moveWithinMatches returns undefined when no matches exist', () => {
    const ctrl = createTypeaheadController(() => undefined);
    ctrl.handleChar('z', entries, 1000); // no match
    const result = ctrl.moveWithinMatches(entries, undefined, 1, undefined, false);
    expect(result).toBeUndefined();
  });
});

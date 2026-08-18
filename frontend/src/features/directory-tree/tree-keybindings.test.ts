import { describe, expect, it } from 'vitest';

import { interpretTreeKey, type TreeFocusedRowState, type TreeKeyEvent } from './tree-keybindings';

function key(key: string, overrides: Partial<TreeKeyEvent> = {}): TreeKeyEvent {
  return { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...overrides };
}

function row(overrides: Partial<TreeFocusedRowState> = {}): TreeFocusedRowState {
  return { expanded: false, hasChildren: undefined, depth: 0, ...overrides };
}

describe('interpretTreeKey', () => {
  it('moves focus up and down', () => {
    expect(interpretTreeKey(key('ArrowDown'), row())).toEqual({ type: 'moveFocus', offset: 1 });
    expect(interpretTreeKey(key('ArrowUp'), row())).toEqual({ type: 'moveFocus', offset: -1 });
  });

  it('jumps to the first/last visible row on Home/End', () => {
    expect(interpretTreeKey(key('Home'), row())).toEqual({ type: 'moveFocusTo', edge: 'first' });
    expect(interpretTreeKey(key('End'), row())).toEqual({ type: 'moveFocusTo', edge: 'last' });
  });

  describe('ArrowRight', () => {
    it('expands a collapsed node with unknown children', () => {
      expect(
        interpretTreeKey(key('ArrowRight'), row({ expanded: false, hasChildren: undefined })),
      ).toEqual({
        type: 'expand',
      });
    });

    it('expands a collapsed node known to have children', () => {
      expect(
        interpretTreeKey(key('ArrowRight'), row({ expanded: false, hasChildren: true })),
      ).toEqual({
        type: 'expand',
      });
    });

    it('does nothing on a collapsed node known to have no children', () => {
      expect(
        interpretTreeKey(key('ArrowRight'), row({ expanded: false, hasChildren: false })),
      ).toBeUndefined();
    });

    it('moves focus into the first child of an already-expanded node', () => {
      expect(
        interpretTreeKey(key('ArrowRight'), row({ expanded: true, hasChildren: true })),
      ).toEqual({
        type: 'moveFocusToFirstChild',
      });
    });
  });

  describe('ArrowLeft', () => {
    it('collapses an expanded node', () => {
      expect(interpretTreeKey(key('ArrowLeft'), row({ expanded: true }))).toEqual({
        type: 'collapse',
      });
    });

    it('moves focus to the parent of a collapsed non-root node', () => {
      expect(interpretTreeKey(key('ArrowLeft'), row({ expanded: false, depth: 1 }))).toEqual({
        type: 'moveFocusToParent',
      });
    });

    it('does nothing on a collapsed root node', () => {
      expect(
        interpretTreeKey(key('ArrowLeft'), row({ expanded: false, depth: 0 })),
      ).toBeUndefined();
    });
  });

  it('activates on Enter or Space', () => {
    expect(interpretTreeKey(key('Enter'), row())).toEqual({ type: 'activate' });
    expect(interpretTreeKey(key(' '), row())).toEqual({ type: 'activate' });
  });

  it('ignores keys with a modifier held', () => {
    expect(interpretTreeKey(key('ArrowDown', { ctrlKey: true }), row())).toBeUndefined();
    expect(interpretTreeKey(key('ArrowDown', { metaKey: true }), row())).toBeUndefined();
    expect(interpretTreeKey(key('ArrowDown', { altKey: true }), row())).toBeUndefined();
    expect(interpretTreeKey(key('ArrowDown', { shiftKey: true }), row())).toBeUndefined();
  });

  it('returns undefined for an unrecognized key', () => {
    expect(interpretTreeKey(key('a'), row())).toBeUndefined();
  });
});

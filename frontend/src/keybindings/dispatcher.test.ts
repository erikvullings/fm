import { describe, expect, it } from 'vitest';

import type { ActionDescriptor } from '../models';
import {
  detectBindingConflicts,
  dispatchKeybinding,
  footerFunctionKeyBindings,
  getLiveBindings,
  type KeybindingContext,
} from './dispatcher';

const actions: readonly ActionDescriptor[] = [
  {
    id: 'core.copy',
    title: 'Copy',
    category: 'fileOperations',
    defaultShortcuts: [{ key: 'F5' }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.palette',
    title: 'Command palette',
    category: 'navigation',
    defaultShortcuts: [{ key: 'p', ctrl: true }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.newTab',
    title: 'New tab',
    category: 'navigation',
    defaultShortcuts: [{ key: 't', ctrl: true }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.rename',
    title: 'Rename',
    category: 'fileOperations',
    defaultShortcuts: [{ key: 'F2' }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.switchPane',
    title: 'Switch pane',
    category: 'navigation',
    defaultShortcuts: [{ key: 'Tab' }, { key: 'Tab', shift: true }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
  {
    id: 'core.nextTab',
    title: 'Next tab',
    category: 'navigation',
    defaultShortcuts: [{ key: 'Tab', ctrl: true }],
    contextRequirements: {},
    source: { kind: 'core' },
  },
];

const table: KeybindingContext = { scope: 'table', platform: 'windows', runtime: 'desktop' };

function event(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe('keybinding dispatcher', () => {
  it('uses a user override before the registry default', () => {
    expect(dispatchKeybinding(event('F6'), table, actions, { 'core.copy': 'F6' })).toBe(
      'core.copy',
    );
    expect(dispatchKeybinding(event('F5'), table, actions, { 'core.copy': 'F6' })).toBeUndefined();
  });

  it('resolves the primary modifier once for each platform', () => {
    expect(
      dispatchKeybinding(
        event('p', { metaKey: true }),
        { ...table, platform: 'macos' },
        actions,
        {},
      ),
    ).toBe('core.palette');
    expect(dispatchKeybinding(event('p', { ctrlKey: true }), table, actions, {})).toBe(
      'core.palette',
    );
    expect(
      dispatchKeybinding(
        event('p', { ctrlKey: true }),
        { ...table, platform: 'macos' },
        actions,
        {},
      ),
    ).toBeUndefined();
  });

  it('matches Ctrl+Tab to tab-cycling rather than pane-switching on macOS (Cmd+Tab is OS-reserved)', () => {
    const macos = { ...table, platform: 'macos' as const };
    expect(dispatchKeybinding(event('Tab', { ctrlKey: true }), macos, actions, {})).toBe(
      'core.nextTab',
    );
    expect(dispatchKeybinding(event('Tab'), macos, actions, {})).toBe('core.switchPane');
    expect(dispatchKeybinding(event('Tab', { shiftKey: true }), macos, actions, {})).toBe(
      'core.switchPane',
    );
    expect(dispatchKeybinding(event('Tab', { metaKey: true }), macos, actions, {})).toBeUndefined();
  });

  it('does not dispatch table actions while a path input or modal has focus', () => {
    expect(
      dispatchKeybinding(event('F5'), { ...table, scope: 'pathInput' }, actions, {}),
    ).toBeUndefined();
    expect(
      dispatchKeybinding(event('F5'), { ...table, scope: 'modal' }, actions, {}),
    ).toBeUndefined();
  });

  it('detects collisions instead of letting the first action shadow the second', () => {
    expect(
      detectBindingConflicts(actions, { 'core.copy': 'F6', 'core.palette': 'F6' }, table),
    ).toEqual([{ shortcut: 'F6', actionIds: ['core.copy', 'core.palette'] }]);
  });

  it('flags browser-reserved bindings as unavailable while retaining them on desktop', () => {
    expect(
      getLiveBindings(actions, {}, { ...table, runtime: 'browser' }).find(
        (binding) => binding.actionId === 'core.palette',
      )?.available,
    ).toBe(false);
    expect(
      getLiveBindings(actions, {}, table).find((binding) => binding.actionId === 'core.palette')
        ?.available,
    ).toBe(true);
  });

  it('reserves Ctrl+T for the browser tab shortcut too (task 0069 core.newTab)', () => {
    expect(
      getLiveBindings(actions, {}, { ...table, runtime: 'browser' }).find(
        (binding) => binding.actionId === 'core.newTab',
      )?.available,
    ).toBe(false);
    expect(
      getLiveBindings(actions, {}, table).find((binding) => binding.actionId === 'core.newTab')
        ?.available,
    ).toBe(true);
  });

  it('always lists footer function keys in ascending F-key order, marking unavailable actions instead of hiding them', () => {
    const bindings = footerFunctionKeyBindings(
      actions,
      {},
      table,
      (action) => action.id === 'core.copy',
    );

    expect(bindings).toEqual([
      { actionId: 'core.rename', shortcut: 'F2', title: 'Rename', actionAvailable: false },
      { actionId: 'core.copy', shortcut: 'F5', title: 'Copy', actionAvailable: true },
    ]);
  });

  it('keeps in-app View and Edit visible but omits other permanently unavailable actions', () => {
    const withGatedAction: readonly ActionDescriptor[] = [
      ...actions,
      {
        id: 'core.view',
        title: 'View',
        category: 'fileOperations',
        defaultShortcuts: [{ key: 'F3' }],
        contextRequirements: { featureAvailable: false },
        source: { kind: 'core' },
      },
      {
        id: 'core.edit',
        title: 'Edit',
        category: 'fileOperations',
        defaultShortcuts: [{ key: 'F4' }],
        contextRequirements: { featureAvailable: false },
        source: { kind: 'core' },
      },
      {
        id: 'plugin.unavailable',
        title: 'Unavailable',
        category: 'fileOperations',
        defaultShortcuts: [{ key: 'F6' }],
        contextRequirements: { featureAvailable: false },
        source: { kind: 'plugin', pluginId: 'test' },
      },
    ];

    const bindings = footerFunctionKeyBindings(withGatedAction, {}, table, () => true);

    expect(bindings.find((binding) => binding.actionId === 'core.view')).toBeDefined();
    expect(bindings.find((binding) => binding.actionId === 'core.edit')).toBeDefined();
    expect(bindings.find((binding) => binding.actionId === 'plugin.unavailable')).toBeUndefined();
  });
});

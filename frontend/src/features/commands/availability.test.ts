import { describe, expect, it } from 'vitest';

import type { ActionDescriptor, EntryId, EntrySummary } from '../../models';
import {
  availableActions,
  type CommandAvailabilityContext,
  evaluateActionAvailability,
  menuActionsForContext,
} from './availability';

function action(
  id: string,
  requirements: ActionDescriptor['contextRequirements'] = {},
): ActionDescriptor {
  return {
    id,
    title: id,
    category: 'test',
    defaultShortcuts: [],
    contextRequirements: requirements,
    source: { kind: 'core' },
  };
}

function entry(kind: EntrySummary['kind'], readOnly = false): EntrySummary {
  return {
    id: `${kind}-${readOnly}` as EntryId,
    location: { providerId: 'file', uri: `mock:///${kind}` },
    name: kind,
    kind,
    hidden: false,
    readOnly,
    metadataRevision: 1,
  };
}

function context(overrides: Partial<CommandAvailabilityContext> = {}): CommandAvailabilityContext {
  return {
    selectedEntries: [],
    locationWritable: true,
    clipboardHasEntries: false,
    openTerminalSupported: false,
    ...overrides,
  };
}

describe('command availability', () => {
  it('evaluates registry requirements without mutating the action or context', () => {
    const descriptor = action('core.rename', { requiresSingleSelection: true });
    const input = context();

    expect(evaluateActionAvailability(descriptor, input)).toEqual({
      action: descriptor,
      available: false,
      reason: 'Select exactly one item',
    });
    expect(descriptor.contextRequirements).toEqual({ requiresSingleSelection: true });
    expect(input.selectedEntries).toEqual([]);
  });

  it('adapts entry actions for a file, directory, multiple selection, and read-only entries', () => {
    const actions = [
      action('core.open', { requiresSingleSelection: true }),
      action('core.rename', { requiresSingleSelection: true }),
      action('core.copy', { requiresSelection: true }),
      action('core.move', { requiresSelection: true }),
      action('core.delete', { requiresSelection: true }),
    ];

    expect(availableActions(actions, context({ selectedEntries: [entry('file')] }))).toEqual([
      { action: actions[0], available: true },
      { action: actions[1], available: true },
      { action: actions[2], available: true },
      { action: actions[3], available: true },
      { action: actions[4], available: true },
    ]);
    expect(availableActions(actions, context({ selectedEntries: [entry('directory')] }))).toEqual(
      expect.arrayContaining([{ action: actions[0], available: true }]),
    );
    expect(
      availableActions(actions, context({ selectedEntries: [entry('file'), entry('directory')] })),
    ).toEqual(
      expect.arrayContaining([
        { action: actions[0], available: false, reason: 'Select exactly one item' },
        { action: actions[1], available: false, reason: 'Select exactly one item' },
      ]),
    );
    expect(availableActions(actions, context({ selectedEntries: [entry('file', true)] }))).toEqual(
      expect.arrayContaining([
        { action: actions[1], available: false, reason: 'Selected item is read-only' },
        { action: actions[3], available: false, reason: 'Selected item is read-only' },
        { action: actions[4], available: false, reason: 'Selected item is read-only' },
      ]),
    );
  });

  it('composes empty-area location actions from the registry and disables unavailable targets', () => {
    const actions = [
      action('core.createDirectory'),
      action('core.paste'),
      action('core.refresh'),
      action('core.openTerminal'),
      action('core.copy', { requiresSelection: true }),
    ];

    expect(menuActionsForContext(actions, context({ locationWritable: false }))).toEqual([
      { action: actions[0], available: false, reason: 'This location is read-only' },
      { action: actions[1], available: false, reason: 'This location is read-only' },
      { action: actions[2], available: true },
      { action: actions[3], available: false, reason: 'Terminal is not supported by this host' },
    ]);
  });

  it('includes core.revealInSystemFileManager in the selection-context menu (task 0061)', () => {
    const actions = [
      action('core.open', { requiresSingleSelection: true }),
      action('core.revealInSystemFileManager', { requiresSingleSelection: true }),
      action('core.createDirectory'),
    ];

    const menu = menuActionsForContext(actions, context({ selectedEntries: [entry('file')] }));

    expect(menu.map((item) => item.action.id)).toEqual([
      'core.open',
      'core.revealInSystemFileManager',
    ]);
    expect(menu).toEqual([
      { action: actions[0], available: true },
      { action: actions[1], available: true },
    ]);
  });

  it('includes core.view and core.edit in the selection-context menu (tasks 0087/0086)', () => {
    const actions = [
      action('core.open', { requiresSingleSelection: true }),
      action('core.view', { requiresSingleSelection: true }),
      action('core.edit', { requiresSingleSelection: true }),
      action('core.createDirectory'),
    ];

    const menu = menuActionsForContext(actions, context({ selectedEntries: [entry('file')] }));

    expect(menu.map((item) => item.action.id)).toEqual(['core.open', 'core.view', 'core.edit']);
    expect(menu).toEqual([
      { action: actions[0], available: true },
      { action: actions[1], available: true },
      { action: actions[2], available: true },
    ]);
  });

  it('includes the available copy name and path actions in the selection-context menu (task 0093)', () => {
    const actions = [
      action('core.copyName', { requiresSelection: true }),
      action('core.copyPath', { requiresSelection: true }),
      action('core.copyRelativePath', { requiresSelection: true }),
    ];

    expect(menuActionsForContext(actions, context({ selectedEntries: [entry('file')] }))).toEqual([
      { action: actions[0], available: true },
      { action: actions[1], available: true },
      { action: actions[2], available: true },
    ]);
  });

  it('keeps core.trash available for a read-only selection, unlike core.delete (task 0043)', () => {
    const actions = [
      action('core.trash', { requiresSelection: true }),
      action('core.delete', { requiresSelection: true }),
    ];

    const result = availableActions(actions, context({ selectedEntries: [entry('file', true)] }));

    expect(result).toEqual([
      { action: actions[0], available: true },
      { action: actions[1], available: false, reason: 'Selected item is read-only' },
    ]);
  });
});

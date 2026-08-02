import type { SelectionPlatform } from '../features/selection/keybindings';
import type { ActionDescriptor, ActionId, KeyChord } from '../models';

export type KeybindingScope = 'table' | 'pathInput' | 'modal';
export type KeybindingRuntime = 'browser' | 'desktop';

export interface KeybindingContext {
  readonly scope: KeybindingScope;
  readonly platform: SelectionPlatform;
  readonly runtime: KeybindingRuntime;
}

export interface LiveBinding {
  readonly actionId: ActionId;
  readonly shortcut: string;
  readonly available: boolean;
}

export interface BindingConflict {
  readonly shortcut: string;
  readonly actionIds: readonly ActionId[];
}

const BROWSER_RESERVED = new Set(['CTRL+P', 'CTRL+W', 'CTRL+T']);

function chordFromText(value: string): KeyChord | undefined {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (key === undefined) return undefined;
  return {
    key,
    ...(parts.some((part) => /^(ctrl|cmd|command)$/iu.test(part)) ? { ctrl: true } : {}),
    ...(parts.some((part) => /^shift$/iu.test(part)) ? { shift: true } : {}),
    ...(parts.some((part) => /^(alt|option)$/iu.test(part)) ? { alt: true } : {}),
  };
}

function effectiveChords(
  action: ActionDescriptor,
  overrides: Readonly<Record<string, string>>,
): readonly KeyChord[] {
  const override = overrides[action.id];
  if (override === undefined) return action.defaultShortcuts;
  const chord = chordFromText(override);
  return chord === undefined ? [] : [chord];
}

function normalizedShortcut(chord: KeyChord): string {
  return [
    ...(chord.ctrl || chord.meta ? ['CTRL'] : []),
    ...(chord.alt ? ['ALT'] : []),
    ...(chord.shift ? ['SHIFT'] : []),
    chord.key.toUpperCase(),
  ].join('+');
}

/** Returns whether an event uses the host's primary shortcut modifier. */
export function hasPrimaryModifier(event: KeyboardEvent, platform: SelectionPlatform): boolean {
  return platform === 'macos' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function matches(event: KeyboardEvent, chord: KeyChord, platform: SelectionPlatform): boolean {
  if (event.key.toUpperCase() !== chord.key.toUpperCase()) return false;
  if (Boolean(chord.ctrl || chord.meta) !== hasPrimaryModifier(event, platform)) return false;
  return Boolean(chord.shift) === event.shiftKey && Boolean(chord.alt) === event.altKey;
}

function available(chord: KeyChord, context: KeybindingContext): boolean {
  return context.runtime !== 'browser' || !BROWSER_RESERVED.has(normalizedShortcut(chord));
}

/** Resolves a keyboard event to one action id without reading from the DOM. */
export function dispatchKeybinding(
  event: KeyboardEvent,
  context: KeybindingContext,
  actions: readonly ActionDescriptor[],
  overrides: Readonly<Record<string, string>>,
): ActionId | undefined {
  if (context.scope !== 'table') return undefined;
  for (const action of actions) {
    for (const chord of effectiveChords(action, overrides)) {
      if (available(chord, context) && matches(event, chord, context.platform)) return action.id;
    }
  }
  return undefined;
}

/** Lists effective bindings for the function-key bar and settings editor. */
export function getLiveBindings(
  actions: readonly ActionDescriptor[],
  overrides: Readonly<Record<string, string>>,
  context: KeybindingContext,
): readonly LiveBinding[] {
  return actions.flatMap((action) => {
    return effectiveChords(action, overrides).map((chord) => ({
      actionId: action.id,
      shortcut: normalizedShortcut(chord),
      available: available(chord, context),
    }));
  });
}

/** Reports effective-shortcut collisions for the settings editor. */
export function detectBindingConflicts(
  actions: readonly ActionDescriptor[],
  overrides: Readonly<Record<string, string>>,
  context: KeybindingContext,
): readonly BindingConflict[] {
  const byShortcut = new Map<string, ActionId[]>();
  for (const binding of getLiveBindings(actions, overrides, context)) {
    if (!binding.available) continue;
    const actionIds = byShortcut.get(binding.shortcut) ?? [];
    actionIds.push(binding.actionId);
    byShortcut.set(binding.shortcut, actionIds);
  }
  return [...byShortcut.entries()]
    .filter(([, actionIds]) => actionIds.length > 1)
    .map(([shortcut, actionIds]) => ({ shortcut, actionIds }));
}

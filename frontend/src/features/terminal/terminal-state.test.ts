import { describe, expect, it } from 'vitest';

import type { Location } from '../../models';
import { isTerminalVisible } from './terminal-state';

const location = (uri: string): Location => ({ providerId: 'local', uri });

describe('terminal folder scope', () => {
  it('keeps the drawer visible while the active folder is unchanged', () => {
    expect(isTerminalVisible(new Set(['file:///work']), location('file:///work'))).toBe(true);
  });

  it('hides the drawer after switching folders', () => {
    expect(isTerminalVisible(new Set(['file:///work']), location('file:///other'))).toBe(false);
  });

  it('restores a folder terminal when that folder becomes active again', () => {
    const openLocations = new Set(['file:///work', 'file:///other']);
    expect(isTerminalVisible(openLocations, location('file:///work'))).toBe(true);
    expect(isTerminalVisible(openLocations, location('file:///other'))).toBe(true);
  });
});

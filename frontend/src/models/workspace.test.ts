import { describe, expect, it } from 'vitest';

import type { WorkspaceDto } from '../api/generated/models/workspaceDto';
import { workspaceProjectionFromDto } from './workspace';

const fixture: WorkspaceDto = {
  schemaVersion: 1,
  id: '985d4d6e-c37b-4135-90a0-ce0afe165fd9',
  name: 'Development',
  revision: 12,
  layout: {
    type: 'split',
    axis: 'horizontal',
    ratio: 0.52,
    first: { type: 'pane', paneId: 'pane-left' },
    second: { type: 'pane', paneId: 'pane-right' },
  },
  panes: [
    {
      id: 'pane-left',
      title: null,
      activeTabId: 'tab-dev',
      defaultView: {
        sort: [],
        columns: [],
        showHidden: false,
        foldersFirst: true,
        quickFilter: null,
      },
      tabs: [
        {
          id: 'tab-dev',
          titleOverride: null,
          location: { providerId: 'local', uri: 'file:///Users/erik/dev' },
          history: {
            back: [],
            forward: [{ providerId: 'local', uri: 'file:///Users/erik' }],
          },
          view: {
            sort: [{ columnId: 'core.name', direction: 'ascending' }],
            columns: [{ columnId: 'core.name', width: 360, visible: true }],
            showHidden: true,
            foldersFirst: true,
            quickFilter: null,
          },
          pinned: false,
        },
      ],
    },
    {
      id: 'pane-right',
      title: null,
      activeTabId: 'tab-downloads',
      defaultView: {
        sort: [],
        columns: [],
        showHidden: false,
        foldersFirst: true,
        quickFilter: null,
      },
      tabs: [
        {
          id: 'tab-downloads',
          titleOverride: 'Downloads',
          location: { providerId: 'local', uri: 'file:///Users/erik/Downloads' },
          history: {
            back: [{ providerId: 'local', uri: 'file:///Users/erik' }],
            forward: [],
          },
          view: {
            sort: [{ columnId: 'core.modified', direction: 'descending' }],
            columns: [{ columnId: 'core.name', width: 340, visible: true }],
            showHidden: false,
            foldersFirst: true,
            quickFilter: null,
          },
          pinned: false,
        },
      ],
    },
  ],
  activePaneId: 'pane-left',
  operationCentre: { visible: true, height: 180 },
  createdAt: '2026-07-30T00:00:00Z',
  updatedAt: '2026-07-30T00:00:00Z',
};

describe('workspaceProjectionFromDto', () => {
  it('normalizes the persisted-workspace example into ordered id maps', () => {
    const projection = workspaceProjectionFromDto(fixture);

    expect(projection).toEqual({
      id: fixture.id,
      name: 'Development',
      revision: 12,
      layout: fixture.layout,
      paneOrder: ['pane-left', 'pane-right'],
      panesById: {
        'pane-left': {
          id: 'pane-left',
          tabOrder: ['tab-dev'],
          tabsById: {
            'tab-dev': {
              id: 'tab-dev',
              title: 'dev',
              location: { providerId: 'local', uri: 'file:///Users/erik/dev' },
              canNavigateBack: false,
              canNavigateForward: true,
              view: fixture.panes[0]?.tabs[0]?.view,
            },
          },
          activeTabId: 'tab-dev',
        },
        'pane-right': {
          id: 'pane-right',
          tabOrder: ['tab-downloads'],
          tabsById: {
            'tab-downloads': {
              id: 'tab-downloads',
              title: 'Downloads',
              location: { providerId: 'local', uri: 'file:///Users/erik/Downloads' },
              canNavigateBack: true,
              canNavigateForward: false,
              view: fixture.panes[1]?.tabs[0]?.view,
            },
          },
          activeTabId: 'tab-downloads',
        },
      },
      activePaneId: 'pane-left',
      operationCentre: { visible: true, height: 180 },
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { Connection, ConnectionConfiguration } from '../../models';
import {
  connectionStatusGlyph,
  connectionStatusLabel,
  isBrowsable,
  sftpRootLocation,
  upsertConnection,
  validateConnectionDraft,
  withoutConnection,
} from './connections-model';

function sshConfiguration(
  overrides: Partial<Extract<ConnectionConfiguration, { kind: 'ssh' }>> = {},
): ConnectionConfiguration {
  return {
    kind: 'ssh',
    host: 'example.test',
    port: 22,
    username: 'erik',
    authentication: 'password',
    hostKeyPolicy: 'promptOnFirstUse',
    keepaliveSeconds: null,
    ...overrides,
  };
}

function sampleConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'connection-1',
    name: 'Home Server',
    kind: 'ssh',
    configuration: sshConfiguration(),
    hasCredential: true,
    status: 'disconnected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('connectionStatusGlyph', () => {
  it('shows a filled dot only when connected', () => {
    expect(connectionStatusGlyph('connected')).toBe('●');
    expect(connectionStatusGlyph('disconnected')).toBe('○');
    expect(connectionStatusGlyph('connecting')).toBe('○');
    expect(connectionStatusGlyph('reconnecting')).toBe('○');
    expect(connectionStatusGlyph('authenticationRequired')).toBe('○');
    expect(connectionStatusGlyph('failed')).toBe('○');
  });
});

describe('connectionStatusLabel', () => {
  it('has a distinct human-readable label for every status', () => {
    const statuses: Connection['status'][] = [
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
      'authenticationRequired',
      'hostKeyUnverified',
      'hostKeyMismatch',
      'failed',
    ];
    const labels = statuses.map(connectionStatusLabel);
    expect(new Set(labels).size).toBe(statuses.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });

  it('distinguishes an unverified host key from a changed one', () => {
    expect(connectionStatusLabel('hostKeyUnverified')).not.toBe(
      connectionStatusLabel('hostKeyMismatch'),
    );
  });
});

describe('isBrowsable', () => {
  it('is true for an ssh connection', () => {
    expect(isBrowsable(sampleConnection({ kind: 'ssh' }))).toBe(true);
  });

  it('is false for every other kind (task 0104: only SSH has a real provider)', () => {
    for (const kind of ['ftp', 'ftps', 'oneDrive', 'webDav', 's3', 'smb'] as const) {
      expect(isBrowsable(sampleConnection({ kind }))).toBe(false);
    }
  });
});

describe('sftpRootLocation', () => {
  it('builds an sftp:// root location for the connection id', () => {
    const location = sftpRootLocation('11111111-1111-4111-8111-111111111111');
    expect(location.providerId).toBe('sftp');
    expect(location.uri).toBe('sftp://11111111-1111-4111-8111-111111111111/');
  });
});

describe('upsertConnection', () => {
  it('appends a connection not already present', () => {
    const existing = [sampleConnection({ id: 'a' })];
    const next = upsertConnection(existing, sampleConnection({ id: 'b', name: 'NAS' }));
    expect(next.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('replaces a connection with a matching id in place, preserving order', () => {
    const existing = [
      sampleConnection({ id: 'a', name: 'A' }),
      sampleConnection({ id: 'b', name: 'B' }),
      sampleConnection({ id: 'c', name: 'C' }),
    ];
    const next = upsertConnection(existing, sampleConnection({ id: 'b', name: 'Renamed B' }));
    expect(next.map((c) => c.name)).toEqual(['A', 'Renamed B', 'C']);
  });

  it('does not mutate the input array', () => {
    const existing = [sampleConnection({ id: 'a' })];
    const frozen = Object.freeze([...existing]);
    expect(() =>
      upsertConnection(frozen, sampleConnection({ id: 'a', name: 'Changed' })),
    ).not.toThrow();
    expect(existing[0]?.name).toBe('Home Server');
  });
});

describe('withoutConnection', () => {
  it('removes only the matching connection', () => {
    const existing = [sampleConnection({ id: 'a' }), sampleConnection({ id: 'b' })];
    expect(withoutConnection(existing, 'a').map((c) => c.id)).toEqual(['b']);
  });

  it('is a no-op when the id is not present', () => {
    const existing = [sampleConnection({ id: 'a' })];
    expect(withoutConnection(existing, 'unknown').map((c) => c.id)).toEqual(['a']);
  });
});

describe('validateConnectionDraft', () => {
  it('accepts a well-formed ssh draft', () => {
    expect(
      validateConnectionDraft({ name: 'Home Server', configuration: sshConfiguration() }),
    ).toEqual([]);
  });

  it('reports an empty name', () => {
    const errors = validateConnectionDraft({ name: '   ', configuration: sshConfiguration() });
    expect(errors).toContainEqual({ field: 'name', message: expect.any(String) });
  });

  it('reports every malformed ssh field at once, not just the first', () => {
    const errors = validateConnectionDraft({
      name: 'Home Server',
      configuration: sshConfiguration({ host: '', username: '', port: 0 }),
    });
    const fields = errors.map((error) => error.field);
    expect(fields).toContain('host');
    expect(fields).toContain('username');
    expect(fields).toContain('port');
  });

  it('rejects an out-of-range port', () => {
    const errors = validateConnectionDraft({
      name: 'Home Server',
      configuration: sshConfiguration({ port: 70_000 }),
    });
    expect(errors.map((error) => error.field)).toContain('port');
  });

  it('does not require ssh-specific fields for a non-ssh kind', () => {
    const errors = validateConnectionDraft({
      name: 'NAS',
      configuration: { kind: 'smb', server: 'nas.local', share: 'media' },
    });
    expect(errors).toEqual([]);
  });
});

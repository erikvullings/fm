import type { PluginId } from './ids';

/** A data-only column declared by a plugin; rendering remains host-owned. */
export interface PluginColumn {
  id: string;
  title: string;
}

/**
 * Manifest-declared capability grants for one plugin (spec §19). A field is
 * denied when it is `false` or empty; omitted at the manifest declares
 * nothing beyond the schema default.
 */
export interface PluginPermissions {
  selectedEntryMetadata: boolean;
  selectedEntryContentRead: boolean;
  filesystemRead: readonly string[];
  filesystemWrite: readonly string[];
  clipboardRead: boolean;
  clipboardWrite: boolean;
  network: readonly string[];
  processSpawn: boolean;
  notifications: boolean;
  settingsStorage: boolean;
}

/** One bounded diagnostic log entry retained for a plugin (spec §19.4). */
export interface PluginLogEntry {
  message: string;
}

/**
 * Minimal projection published by the `plugin.changed` event (spec §19.5).
 * The backend only broadcasts the fields that change on enable/disable;
 * consumers merge this into an already-discovered {@link PluginDescriptor}.
 */
export interface PluginSummary {
  id: PluginId;
  name: string;
  version: string;
  enabled: boolean;
}

/**
 * Describes a discovered plugin (spec §19). Left minimal until task 0053
 * defines the full manifest/descriptor contract.
 */
export interface PluginDescriptor {
  id: PluginId;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  diagnostic?: string;
  columns?: readonly PluginColumn[];
  permissions?: PluginPermissions;
}

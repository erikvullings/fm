import type { PluginId } from './ids';

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
}

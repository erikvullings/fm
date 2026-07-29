import type { EntryId, ProviderId } from './ids';

/**
 * A provider-neutral pointer to a location (spec §5.1), mirroring
 * `fm_transport_dto::LocationDto`.
 */
export interface Location {
  providerId: ProviderId;
  uri: string;
}

/** Identifies an entry without its full summary, e.g. for metadata requests (spec §6). */
export interface EntryRef {
  id: EntryId;
  location: Location;
}

import type { EntryKind } from '../../models';

/** Supported byte-size presentations. Task 0030 can persist these string values directly. */
export type EntrySizeFormat = 'binary' | 'decimal' | 'bytes';

/** Supported modified-time presentations. Task 0030 can persist these string values directly. */
export type EntryDateFormat = 'medium' | 'short' | 'iso';

/**
 * Minimal settings consumed by entry presentation.
 *
 * Locale and time zone are optional rendering context rather than persisted user
 * preferences; exposing them keeps formatting deterministic in tests and hosts.
 */
export interface EntryFormatSettings {
  readonly sizeFormat: EntrySizeFormat;
  readonly dateFormat: EntryDateFormat;
  readonly locale?: string;
  readonly timeZone?: string;
}

/** Presentation defaults used until the settings service from task 0030 is available. */
export const DEFAULT_ENTRY_FORMAT_SETTINGS: EntryFormatSettings = Object.freeze({
  sizeFormat: 'binary',
  dateFormat: 'medium',
});

export interface EntrySizeValue {
  readonly kind: EntryKind;
  readonly size?: number;
}

const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
const DECIMAL_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

function scaledSize(
  bytes: number,
  base: 1_000 | 1_024,
  units: readonly string[],
  locale?: string,
): string {
  const unitIndex =
    bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);
  const value = bytes / base ** unitIndex;
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

/** Formats the raw entry byte count according to settings; directories never expose a size. */
export function formatEntrySize(
  entry: EntrySizeValue,
  settings: EntryFormatSettings = DEFAULT_ENTRY_FORMAT_SETTINGS,
): string {
  if (entry.kind === 'directory' || entry.size === undefined) {
    return '--';
  }
  if (settings.sizeFormat === 'bytes') {
    return `${new Intl.NumberFormat(settings.locale, { maximumFractionDigits: 0 }).format(entry.size)} B`;
  }
  return settings.sizeFormat === 'binary'
    ? scaledSize(entry.size, 1_024, BINARY_UNITS, settings.locale)
    : scaledSize(entry.size, 1_000, DECIMAL_UNITS, settings.locale);
}

/** Formats a raw ISO timestamp according to settings. */
export function formatEntryModifiedAt(
  timestamp: string | undefined,
  settings: EntryFormatSettings = DEFAULT_ENTRY_FORMAT_SETTINGS,
): string {
  if (timestamp === undefined) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  if (settings.dateFormat === 'iso') {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
  return new Intl.DateTimeFormat(settings.locale, {
    dateStyle: settings.dateFormat,
    timeStyle: 'short',
    ...(settings.timeZone === undefined ? {} : { timeZone: settings.timeZone }),
  }).format(date);
}

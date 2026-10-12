/**
 * Dates and times in the visitor's own locale. Halfway is global, so nothing
 * here assumes a language, calendar or 12/24-hour preference beyond what the
 * browser reports.
 */

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(ms);
}

export function formatShortDay(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(ms);
}

export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ms);
}

const ORDINALS = ['one', 'two', 'three'] as const;

export function chapterWord(index: number): string {
  return ORDINALS[index] ?? String(index + 1);
}

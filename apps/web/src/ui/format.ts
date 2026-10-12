const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds as m:ss, the way a player shows them. */
export function clock(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The time between two instants as mm:ss, for the event log. */
export function stamp(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function repoName(repoUrl: string): string {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  if (match) return `${match[1]}/${match[2]}`;
  // A run the command-line tool made on a local folder is named by the folder, never by its path on someone's disk.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repoUrl)) return repoUrl;
  return repoUrl.replace(/\/+$/, '').split('/').at(-1) || repoUrl;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A UTC date written by hand, so the server and every browser render the same string. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const HOUR = 60 * 60 * 1000;

/** The window a run read, as a span and the day it ends: "7 days to 12 Oct 2026". */
export function windowLabel(sinceIso: string, untilIso: string): string {
  const ms = Date.parse(untilIso) - Date.parse(sinceIso);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const hours = Math.max(1, Math.round(ms / HOUR));
  const span = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${span} to ${shortDate(untilIso)}`;
}

/** A fragment from the pipeline as a sentence: capital first, closed with a full stop. */
export function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const closed = /[.!?…]$/.test(t) ? t : `${t}.`;
  return closed[0]!.toUpperCase() + closed.slice(1);
}

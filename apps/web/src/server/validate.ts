export function parseRepoUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  if (url.search || url.hash) return null;

  const path = url.pathname.replace(/\/+$/, '');
  const match = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(\.git)?$/.exec(path);
  if (!match) return null;

  return `https://github.com/${match[1]}/${match[2]}${match[3] ?? ''}`;
}

const HOURS = /^(\d+)h$/;
const DAYS = /^(\d+)d$/;

export function parseSince(input: string, now: Date): string | null {
  const hours = HOURS.exec(input);
  if (hours) return new Date(now.getTime() - Number(hours[1]) * 60 * 60 * 1000).toISOString();

  const days = DAYS.exec(input);
  if (days) return new Date(now.getTime() - Number(days[1]) * 24 * 60 * 60 * 1000).toISOString();

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export const RUN_ID_PATTERN = /^run_[0-9a-f]+$/;
export const MEDIA_FILES = new Set(['reel.mp4', 'reel.srt', 'poster.png']);

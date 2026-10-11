import { redact, type IngestArtifact } from '@dailies/core';
import { ingest, NoCheckpointsError } from '@dailies/ingest';
import type { Stage } from '../types';

const NO_SESSIONS = 'no agent sessions found in this window';

const ERROR_KEEP_CHARS = 1000;
// Larger than any secret, so one that sits on a cut is inside the scrubbed window whole before the cut is made.
const SCRUB_MARGIN = 8192;
// "git" as a user name is no secret, and replacing it would take every "git" out of git's own message.
const MIN_CREDENTIAL_CHARS = 4;
const USERINFO = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#]*@/gi;

/** The user name and password in a repository URL, as written and percent-decoded, longest first. */
function credentialsOf(repoUrl: string): string[] {
  let parts: string[];
  try {
    const { username, password } = new URL(repoUrl);
    parts = [username, password];
  } catch {
    return [];
  }
  const decoded = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  return [...new Set([...parts, ...decoded])].filter((part) => part.length >= MIN_CREDENTIAL_CHARS).sort((a, b) => b.length - a.length);
}

/**
 * `text` without the given credentials, without the userinfo of any URL in it, and without anything else the
 * redactor knows. A token pasted into the repository URL comes back in git's error messages, and the runner
 * stores those with the run.
 */
function scrub(text: string, credentials: string[]): string {
  const literal = credentials.reduce((t, credential) => t.split(credential).join('[REDACTED]'), text);
  return redact(literal.replace(USERINFO, '$1')).text;
}

/** The start and the end of an error message, scrubbed. git can fill a 64 MB buffer; a run record holds 2000 characters of it. */
function scrubbedError(message: string, credentials: string[]): string {
  if (message.length <= 2 * ERROR_KEEP_CHARS) return scrub(message, credentials);
  const head = scrub(message.slice(0, ERROR_KEEP_CHARS + SCRUB_MARGIN), credentials).slice(0, ERROR_KEEP_CHARS);
  const tail = scrub(message.slice(-(ERROR_KEEP_CHARS + SCRUB_MARGIN)), credentials).slice(-ERROR_KEEP_CHARS);
  return `${head} … ${tail}`;
}

export function ingestStage(): Stage<IngestArtifact> {
  return {
    name: 'ingest',
    maxAttempts: 2,
    async run(ctx) {
      const { repoUrl, since, until } = ctx.run;
      const credentials = credentialsOf(repoUrl);
      let found: IngestArtifact;
      try {
        found = await ingest({ repoUrl, dataDir: ctx.dataDir, since, until });
      } catch (err) {
        if (!(err instanceof NoCheckpointsError)) throw new Error(scrubbedError(err instanceof Error ? err.message : String(err), credentials));
        found = { repo: { url: repoUrl, dir: '', headSha: '' }, sessions: [], diffs: {}, skipped: [], enrichments: {}, redactions: 0 };
      }
      const artifact: IngestArtifact = { ...found, repo: { ...found.repo, url: scrub(found.repo.url, credentials) } };

      // Nothing to tell: the run ends here, before any model is asked and before anything is rendered.
      if (artifact.sessions.length === 0) return { artifact, final: { status: 'blocked', reason: NO_SESSIONS } };

      const count = artifact.sessions.length;
      ctx.log(`${count} session${count === 1 ? '' : 's'}, ${Object.keys(artifact.diffs).length} file diffs, ${artifact.redactions} redactions, ${artifact.skipped.length} checkpoints skipped`);
      return { artifact };
    },
  };
}

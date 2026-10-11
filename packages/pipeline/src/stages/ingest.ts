import { redact, type IngestArtifact } from '@dailies/core';
import { ingest, NoCheckpointsError } from '@dailies/ingest';
import type { Stage } from '../types';

const NO_SESSIONS = 'no agent sessions found in this window';

const ERROR_KEEP_CHARS = 1000;
// "git" as a user name is no secret, and replacing it would take every "git" out of git's own message.
const MIN_CREDENTIAL_CHARS = 4;
// The authority the way git reads it: the userinfo runs to the last "@" before the first "/", whatever it holds.
const USERINFO = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/]*@/gi;
const OWN_USERINFO = /^[a-z][a-z0-9+.-]{0,31}:\/\/([^\s/]*)@/i;

/** The user name and password in a repository URL, as written and percent-decoded, longest first. */
function credentialsOf(repoUrl: string): string[] {
  const userinfo = OWN_USERINFO.exec(repoUrl)?.[1];
  if (userinfo === undefined) return [];
  const colon = userinfo.indexOf(':');
  const parts = colon === -1 ? [userinfo] : [userinfo.slice(0, colon), userinfo.slice(colon + 1)];
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

/**
 * The start and the end of an error message, scrubbed. git can fill a 64 MB buffer; a run record holds 2000
 * characters of it. The cut comes first and takes the word it lands in with it, so nothing is scrubbed in part
 * and nothing from beyond the cut can slide into what is kept.
 */
function scrubbedError(message: string, credentials: string[]): string {
  if (message.length <= 2 * ERROR_KEEP_CHARS) return scrub(message, credentials);
  const head = message.slice(0, ERROR_KEEP_CHARS).replace(/\S+$/, '');
  const tail = message.slice(-ERROR_KEEP_CHARS).replace(/^\S+/, '');
  return scrub(`${head} … ${tail}`, credentials);
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
      const artifact: IngestArtifact = {
        ...found,
        // `dir` too: ingest names the clone after the URL, and a one-part path puts the end of the userinfo into
        // that name. Whatever stands before the last "@" of the name is dropped, only for a URL that has userinfo.
        repo: {
          ...found.repo,
          url: scrub(found.repo.url, credentials),
          dir: scrub(OWN_USERINFO.test(repoUrl) ? found.repo.dir.replace(/[^/]*@(?=[^/]*$)/, '') : found.repo.dir, credentials),
        },
        skipped: found.skipped.map((skip) => ({ ...skip, reason: scrubbedError(skip.reason, credentials) })),
      };

      // Nothing to tell: the run ends here, before any model is asked and before anything is rendered.
      if (artifact.sessions.length === 0) return { artifact, final: { status: 'blocked', reason: NO_SESSIONS } };

      const count = artifact.sessions.length;
      ctx.log(`${count} session${count === 1 ? '' : 's'}, ${Object.keys(artifact.diffs).length} file diffs, ${artifact.redactions} redactions, ${artifact.skipped.length} checkpoints skipped`);
      return { artifact };
    },
  };
}

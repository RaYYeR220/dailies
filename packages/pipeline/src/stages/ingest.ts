import { redact, type IngestArtifact } from '@dailies/core';
import { ingest, NoCheckpointsError } from '@dailies/ingest';
import type { Stage } from '../types';

const NO_SESSIONS = 'no agent sessions found in this window';

/**
 * `text` without the user and password of any URL in it, and without anything else the redactor knows. A token
 * pasted into the repository URL comes back in git's error messages, and the runner stores those with the run.
 */
function withoutCredentials(text: string): string {
  return redact(text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1')).text;
}

export function ingestStage(): Stage<IngestArtifact> {
  return {
    name: 'ingest',
    maxAttempts: 2,
    async run(ctx) {
      const { repoUrl, since, until } = ctx.run;
      let found: IngestArtifact;
      try {
        found = await ingest({ repoUrl, dataDir: ctx.dataDir, since, until });
      } catch (err) {
        if (!(err instanceof NoCheckpointsError)) throw new Error(withoutCredentials(err instanceof Error ? err.message : String(err)));
        found = { repo: { url: repoUrl, dir: '', headSha: '' }, sessions: [], diffs: {}, skipped: [], enrichments: {}, redactions: 0 };
      }
      const artifact: IngestArtifact = { ...found, repo: { ...found.repo, url: withoutCredentials(found.repo.url) } };

      // Nothing to tell: the run ends here, before any model is asked and before anything is rendered.
      if (artifact.sessions.length === 0) return { artifact, final: { status: 'blocked', reason: NO_SESSIONS } };

      const count = artifact.sessions.length;
      ctx.log(`${count} session${count === 1 ? '' : 's'}, ${Object.keys(artifact.diffs).length} file diffs, ${artifact.redactions} redactions, ${artifact.skipped.length} checkpoints skipped`);
      return { artifact };
    },
  };
}

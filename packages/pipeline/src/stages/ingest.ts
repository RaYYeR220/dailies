import type { IngestArtifact } from '@dailies/core';
import { ingest, NoCheckpointsError } from '@dailies/ingest';
import type { Stage } from '../types';

const NO_SESSIONS = 'no agent sessions found in this window';

export function ingestStage(): Stage<IngestArtifact> {
  return {
    name: 'ingest',
    maxAttempts: 2,
    async run(ctx) {
      const { repoUrl, since, until } = ctx.run;
      let artifact: IngestArtifact;
      try {
        artifact = await ingest({ repoUrl, dataDir: ctx.dataDir, since, until });
      } catch (err) {
        if (!(err instanceof NoCheckpointsError)) throw err;
        artifact = { repo: { url: repoUrl, dir: '', headSha: '' }, sessions: [], diffs: {}, skipped: [], enrichments: {}, redactions: 0 };
      }
      // Nothing to tell: the run ends here, before any model is asked and before anything is rendered.
      if (artifact.sessions.length === 0) return { artifact, final: { status: 'blocked', reason: NO_SESSIONS } };

      const count = artifact.sessions.length;
      ctx.log(`${count} session${count === 1 ? '' : 's'}, ${Object.keys(artifact.diffs).length} file diffs, ${artifact.redactions} redactions, ${artifact.skipped.length} checkpoints skipped`);
      return { artifact };
    },
  };
}

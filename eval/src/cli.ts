import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Session } from '@dailies/core';
import { ingest } from '@dailies/ingest';
import { buildScorecard, safeCommand } from './scorecard';
import { runGroundingBenchmark } from './grounding';
import { runMutationBenchmark } from './mutation';
import { repoKey } from './repoKey';
import { unrecognisedTails } from './tails';

interface DatasetEntry {
  url: string;
  maxSessions: number;
}

async function main(): Promise<void> {
  const dataDir = resolve(process.cwd(), '.dailies');
  const datasetPath = resolve(import.meta.dirname, '../datasets/public.json');
  const dataset: DatasetEntry[] = JSON.parse(await readFile(datasetPath, 'utf8'));

  const sessionsByRepo: { repo: string; session: Session }[] = [];
  const allSessions: Session[] = [];
  const skipped: { repo: string; reason: string }[] = [];

  for (const entry of dataset) {
    try {
      const artifact = await ingest({
        repoUrl: entry.url,
        dataDir,
        since: new Date(0).toISOString(),
        until: new Date().toISOString(),
        maxSessions: entry.maxSessions,
      });
      for (const session of artifact.sessions) {
        sessionsByRepo.push({ repo: entry.url, session });
        allSessions.push(session);
      }
    } catch (err) {
      skipped.push({ repo: entry.url, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const mutation = runMutationBenchmark(sessionsByRepo);
  const grounding = runGroundingBenchmark();
  const tails = unrecognisedTails(allSessions);

  const date = new Date().toISOString().slice(0, 10);
  const resultsDir = resolve(import.meta.dirname, '../results');
  await mkdir(resultsDir, { recursive: true });

  // Evaluation results never name a repository (Global Constraint): hash the repo and reduce
  // the command to a safe class:programName form before anything touches disk, even though
  // buildScorecard applies the same two transforms again for the Markdown report. A raw command
  // is arbitrary agent-authored shell text — real sessions have recorded a bare module path
  // (`github.com/owner/repo`, no scheme) and an operator's local filesystem path with their
  // username in it, neither of which `repoKey` on the `repo` field alone would catch.
  const sanitizedMutation = {
    ...mutation,
    cases: mutation.cases.map((c) => ({ ...c, repo: repoKey(c.repo), command: safeCommand(c.command) })),
  };
  const sanitizedSkipped = skipped.map((s) => ({ ...s, repo: repoKey(s.repo) }));

  await writeFile(resolve(resultsDir, `${date}-mutation.json`), `${JSON.stringify(sanitizedMutation, null, 2)}\n`);
  await writeFile(resolve(resultsDir, `${date}-grounding.json`), `${JSON.stringify(grounding, null, 2)}\n`);
  await writeFile(
    resolve(resultsDir, `${date}-scorecard.md`),
    buildScorecard({ date, mutation, grounding, skipped, tails }),
  );

  const total = mutation.recognised + mutation.unknown;
  const rate = total === 0 ? 0 : mutation.recognised / total;
  const flipped = mutation.cases.filter((c) => c.flipped).length;
  console.log(`recognition rate: ${rate.toFixed(3)} (${mutation.recognised}/${total})`);
  console.log(`flip rate: ${mutation.flipRate.toFixed(3)} (${flipped}/${mutation.cases.length})`);
  console.log(`grounding: ${grounding.rejected}/${grounding.fabricated} rejected, ${grounding.accepted}/${grounding.genuine} accepted`);
  if (sanitizedSkipped.length > 0) {
    console.log(`skipped ${sanitizedSkipped.length} repositor${sanitizedSkipped.length === 1 ? 'y' : 'ies'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@dailies/agent';
import type { IngestArtifact } from '@dailies/core';
import { buildStages, getRun, runPipeline } from '../../src/index';
import type { GateArtifact, GroundArtifact, Stage, StageDeps, VerifyArtifact, VoiceArtifact } from '../../src/index';
import { recordSpend } from '../../src/stages/index';
import { cleanup, harness, json, promptText, twoBeats, twoSessions, writerReply, type MockRequest } from './fixture';

afterEach(cleanup);

const stage = (deps: StageDeps, name: string) => buildStages(deps).find((s) => s.name === name)!;

/** Every model of the pipeline, answering the two-session fixture the way a well-behaved one would. */
function everyRole(req: MockRequest): ChatMessage {
  const told = promptText(req.messages);
  if (req.role === 'editor') return json({ beats: twoBeats().beats.map(({ id: _id, ...beat }) => beat) });
  if (req.role === 'extractor') {
    return told.includes('"entryId":"s1:6"')
      ? json({ claims: [{ entryId: 's1:6', quote: 'All tests pass and the build is green.', kind: 'tests_pass' }] })
      : json({ claims: [{ entryId: 's2:6', quote: 'All 3 tests pass.', kind: 'tests_pass' }, { entryId: 's2:6', quote: 'Added the --json flag to the status command.', kind: 'implemented', subject: '--json flag' }] });
  }
  if (req.role === 'judge') {
    return told.includes('"entailed"') ? json({ entailed: true }) : json({ supported: true, path: 'src/status.ts', quote: 'if (opts.json) return console.log(JSON.stringify(report));' });
  }
  if (req.role === 'writer') return json(writerReply());
  throw new Error(`unexpected role ${req.role}`);
}

describe('buildStages', () => {
  it('buildStages returns the eight stages in pipeline order, leaving review to be inserted before the gate', () => {
    const h = harness();

    expect(buildStages(h.deps).map((s) => s.name)).toEqual(['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'gate']);
  });

  it('buildStages records what a stage spent on the model against the run', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: everyRole, costPerCall: 0.02 });

    await stage(h.deps, 'verify').run(h.ctx());

    expect(h.calls).toHaveLength(3);   // two extractor batches and one judge call
    expect(getRun(h.db, h.runId).costUsd).toBeCloseTo(0.06, 10);
  });

  it('buildStages records the spend of a stage that fails as well', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => {
        throw new Error('boom');
      },
      costPerCall: 0.05,
    });

    await expect(stage(h.deps, 'verify').run(h.ctx())).rejects.toThrow(/boom/);

    expect(getRun(h.db, h.runId).costUsd).toBeCloseTo(0.05, 10);
  });

  it('buildStages records nothing for a stage that did not use the model', async () => {
    const h = harness({ artifacts: { ingest: twoSessions(), ground: { storyboard: { repo: 'acme/retry-queue', scenes: [] } } } });
    h.meter.add(0.1);   // spent earlier in the run, by another stage

    await stage(h.deps, 'gate').run(h.ctx());

    expect(getRun(h.db, h.runId).costUsd).toBe(0);
  });

  it('recordSpend wraps a stage built elsewhere, such as the review stage', async () => {
    const h = harness();
    const review: Stage<{ pass: boolean }> = {
      name: 'review',
      maxAttempts: 2,
      run: async () => {
        h.meter.add(0.03);
        return { artifact: { pass: true } };
      },
    };

    const wrapped = recordSpend(h.deps, review);
    const result = await wrapped.run(h.ctx());

    expect(wrapped).toMatchObject({ name: 'review', maxAttempts: 2 });
    expect(result).toEqual({ artifact: { pass: true } });
    expect(getRun(h.db, h.runId).costUsd).toBeCloseTo(0.03, 10);
  });

  it('the stages compose through the runner: one flag, grounded lines, four passing checks, spend on the run', async () => {
    const h = harness({ reply: everyRole, costPerCall: 0.01 });
    const ingest: Stage<IngestArtifact> = { name: 'ingest', maxAttempts: 1, run: async () => ({ artifact: twoSessions() }) };
    // the real ingest needs a repository and the real render a browser; both have their own tests
    const stages = [ingest, ...buildStages(h.deps).filter((s) => s.name !== 'ingest' && s.name !== 'render')];

    const status = await runPipeline(h.db, h.runId, stages, { dataDir: h.dataDir, sleep: async () => {} });

    const read = <T>(name: string) => JSON.parse(readFileSync(join(h.dataDir, 'runs', h.runId, `${name}.json`), 'utf8')) as T;
    const run = getRun(h.db, h.runId);
    expect(status).toBe('needs_approval');
    expect(run.reason).toBe('awaiting human approval');

    expect(read<VerifyArtifact>('verify').counts).toEqual({ verified: 2, contradicted: 1, stale: 0, unverifiable: 0 });
    const ground = read<GroundArtifact>('ground');
    expect(ground.storyboard.scenes.map((s) => s.type)).toEqual(['title', 'prompt', 'diff', 'terminal', 'flag', 'terminal', 'stats', 'end']);
    expect(ground.dropped).toEqual([]);
    expect(ground.kept).toBe(7);
    expect(read<VoiceArtifact>('voice')).toMatchObject({ mode: 'captions', calls: 0 });
    expect(read<VoiceArtifact>('voice').timings).toHaveLength(7);
    const gate = read<GateArtifact>('gate');
    expect(gate.checks.map((c) => [c.name, c.pass])).toEqual([['grounding', true], ['secrets', true], ['cost', true], ['review', true]]);

    // editor 1, extractor 2, judge of the implemented claim 1, writer 1, entailment 5
    expect(h.calls).toHaveLength(10);
    expect(run.costUsd).toBeCloseTo(0.1, 10);
    expect(run.costUsd).toBeCloseTo(h.meter.total(), 10);
  });
});

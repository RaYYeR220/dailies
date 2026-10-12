// Field scan: no model calls. Finds "tests pass"-style statements at the end of a turn by pattern and judges them
// with the deterministic rule. The pattern is crude on purpose: it is a way to put the rules in front of real
// sessions, not the product's claim extractor. Aggregates go to stdout; per-flag detail goes only to --detail <file>.
// usage: tsx src/field-scan.ts <dataset.json> [--since ISO] [--detail file.jsonl]
import { ingest } from '@dailies/ingest';
import { collectRuns, verifyClaim } from '@dailies/verify';
import type { Claim, Session } from '@dailies/core';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const PAT = /[^.\n!?]*\b(?:all\s+(?:\d+\s+)?tests?\s+(?:are\s+|now\s+)?(?:pass(?:ing|ed|es)?|green)|tests?\s+(?:all\s+|now\s+|are\s+)*(?:pass(?:ing|ed|es)?|green)|\d+\s*\/\s*\d+\s+(?:tests?\s+)?pass(?:ing|ed)?|test suite (?:passes|is green)|\d+\s+(?:tests?\s+)?passed)\b[^.\n!?]*/i;
const NEG = /\b(?:not|n't|fail|failing|failed|don't|doesn't|didn't|won't|until|once|should|will|if|when|make sure|ensure|verify that|to confirm|before)\b/i;

function candidates(s: Session): Claim[] {
  const out: Claim[] = [];
  const e = s.entries;
  for (let i = 0; i < e.length; i++) {
    if (e[i]!.kind !== 'assistant') continue;
    const next = e[i + 1];
    if (next && next.kind !== 'user') continue;                 // only the message that ends a turn
    const m = PAT.exec(e[i]!.text);
    if (!m) continue;
    const quote = m[0].trim().slice(0, 200);
    if (quote.length < 8 || NEG.test(quote)) continue;          // skip conditionals and negations
    out.push({ id: `${s.id}:${i}`, sessionId: s.id, entryId: e[i]!.id, quote, kind: 'tests_pass', evidence: [] });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dataset = args[0]; if (!dataset) { console.error('usage: field-scan <dataset.json> [--since ISO] [--detail file.jsonl]'); process.exit(1); }
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const repos: { url: string; maxSessions?: number }[] = JSON.parse(readFileSync(dataset, 'utf8'));
  const since = opt('--since') ?? '2026-10-09T00:00:00Z'; const until = new Date().toISOString();
  const detail = opt('--detail'); if (detail) writeFileSync(detail, '');
  const dataDir = process.env.DAILIES_DATA_DIR ?? '.dailies';
  const total = { repos: 0, failed: 0, sessions: 0, entries: 0, runs: {} as Record<string, number>, statements: {} as Record<string, number>, reposWithFlags: 0, flags: 0 };
  const queue = [...repos];
  async function worker() {
    for (;;) {
      const r = queue.shift(); if (!r) return;
      try {
        const a = await ingest({ repoUrl: r.url, dataDir, since, until, maxSessions: r.maxSessions ?? 12 });
        total.repos += 1; total.sessions += a.sessions.length; total.entries += a.sessions.reduce((n, s) => n + s.entries.length, 0);
        for (const x of a.sessions.flatMap((s) => collectRuns(s))) { const k = `${x.cls}:${x.outcome}`; total.runs[k] = (total.runs[k] ?? 0) + 1; }
        let flags = 0;
        for (const s of a.sessions) for (const c of candidates(s)) {
          const v = verifyClaim(c, s); const verdict = v.verdict ?? 'none';
          total.statements[verdict] = (total.statements[verdict] ?? 0) + 1;
          if (verdict === 'contradicted' || verdict === 'stale') { flags += 1; if (detail) appendFileSync(detail, JSON.stringify({ repo: r.url, session: s.id, entry: c.entryId, verdict, quote: c.quote, reason: v.reason }) + '\n'); }
        }
        total.flags += flags; if (flags) total.reposWithFlags += 1;
      } catch { total.failed += 1; }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  console.log(JSON.stringify(total, null, 2));
}
main();

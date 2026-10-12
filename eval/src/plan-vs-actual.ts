// Plan against actual: what recorded runs cost, next to the cost of a reel the business plan assumes and the
// ceiling it allows. Reads the run database and the run artifacts; prints Markdown. No model is involved.
// usage: tsx src/plan-vs-actual.ts <plan.json> <dataDir | rows.json> [...]
// A rows.json is what `--dump <dataDir>` prints: the same rows, for a data directory on another machine.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface Plan { plannedCostPerReelUsd: number; targetGrossMargin: number; pricing: { solo: { pricePerMonth: number; reelsPerMonth: number } }; maxCostPerReelUsd: { solo: number } }
interface Row { id: string; repo: string; status: string; reason: string | null; cost: number; created: string; sessions: number | null; seconds: number | null; reached: string | null }

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null);
/** A repository's public name; a local path is reduced to its last folder, so no machine path is printed. */
const label = (repoUrl: string) => repoUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/^.*\/(?=[^/]+$)/, (m) => (repoUrl.startsWith('http') ? m : ''));
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function rowsOf(dataDir: string): Row[] {
  const dbPath = join(dataDir, 'dailies.db');
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const runs = db.prepare('SELECT id, repo_url, status, reason, cost_usd, created_at FROM runs ORDER BY created_at').all() as { id: string; repo_url: string; status: string; reason: string | null; cost_usd: number; created_at: string }[];
  const lastDone = db.prepare("SELECT name FROM stages WHERE run_id = ? AND status = 'done' ORDER BY ended_at DESC LIMIT 1");
  return runs.map((r) => {
    const dir = join(dataDir, 'runs', r.id);
    const reached = (lastDone.get(r.id) as { name: string } | undefined)?.name ?? null;
    const ingest = readJson<{ sessions: unknown[]; repo?: { dir?: string } }>(join(dir, 'ingest.json'));
    // A run started on a local path (`dailies run .`) is named after the folder that was read.
    const local = /^https?:/.test(r.repo_url) ? null : (ingest?.repo?.dir ?? r.repo_url).replace(/\/+$/, '').split('/').at(-1) || null;
    const render = readJson<{ durationSec: number }>(join(dir, 'render.json'));
    // Only this project's own repositories are named; a run on anyone else's is listed without its name.
    const own = local ?? label(r.repo_url);
    const named = /^(RaYYeR220\/|acme-api-demo$)/.test(own) ? own : 'a public repository';
    return { id: r.id, repo: named, status: r.status, reason: r.reason, cost: r.cost_usd, created: r.created_at, sessions: ingest?.sessions.length ?? null, seconds: render?.durationSec ?? null, reached };
  });
}

function main() {
  if (process.argv[2] === '--dump') { console.log(JSON.stringify(rowsOf(process.argv[3] ?? '.dailies'))); return; }
  const [planPath, ...dataDirs] = process.argv.slice(2);
  if (!planPath || dataDirs.length === 0) { console.error('usage: plan-vs-actual <plan.json> <dataDir | rows.json> [...]'); process.exit(1); }
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
  const ceiling = plan.maxCostPerReelUsd.solo;
  const { pricePerMonth, reelsPerMonth } = plan.pricing.solo;
  const marginAt = (cost: number) => 1 - (cost * reelsPerMonth) / pricePerMonth;

  const rows = dataDirs.flatMap((d) => (d.endsWith('.json') ? (JSON.parse(readFileSync(d, 'utf8')) as Row[]) : rowsOf(d))).sort((a, b) => a.created.localeCompare(b.created));
  const reels = rows.filter((r) => r.seconds !== null);
  const costs = reels.map((r) => r.cost).sort((a, b) => a - b);
  const mean = costs.reduce((n, c) => n + c, 0) / (costs.length || 1);
  const median = costs.length ? costs[Math.floor((costs.length - 1) / 2)]! : 0;
  const over = reels.filter((r) => r.cost > ceiling);

  const out: string[] = [];
  out.push('# Plan against actual', '');
  out.push(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`eval/src/plan-vs-actual.ts\` from the run database. Every run that reached a rendered reel is listed; nothing is left out.`, '');
  out.push('| | Plan | Actual |', '|---|---|---|');
  out.push(`| Cost of one reel | ${usd(plan.plannedCostPerReelUsd)} | ${usd(mean)} mean, ${usd(median)} median, over ${reels.length} reels |`);
  out.push(`| Ceiling for a ${pct(plan.targetGrossMargin).replace('.0', '')} margin on Solo | $${ceiling} | ${over.length} of ${reels.length} reels cost more |`);
  out.push(`| Gross margin on Solo (${reelsPerMonth} reels for $${pricePerMonth}) | ${pct(marginAt(plan.plannedCostPerReelUsd))} | ${pct(marginAt(mean))} at the mean cost |`, '');
  out.push('## Runs', '', '| Run | Repository | Sessions | Reel | Cost | Against the ceiling | Outcome |', '|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const reel = r.seconds === null ? 'none' : `${Math.round(r.seconds)} s`;
    const against = r.seconds === null ? '' : r.cost > ceiling ? `over by ${usd(r.cost - ceiling)}` : `${pct(r.cost / ceiling)} of it`;
    const outcome =
      r.seconds === null && r.status !== 'blocked' && r.status !== 'failed' ? `no reel; last stage done: ${r.reached ?? 'none'}`
      : r.status === 'needs_approval' ? 'passed the gate, awaiting approval'
      : r.status === 'approved' ? 'approved'
      : `${r.status}${r.reason ? `: ${r.reason}` : ''}`;
    out.push(`| \`${r.id}\` | ${r.repo} | ${r.sessions ?? ''} | ${reel} | ${usd(r.cost)} | ${against} | ${outcome} |`);
  }
  console.log(out.join('\n'));
}
main();

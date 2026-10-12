import Link from 'next/link';
import { CopyCommand } from '../ui/CopyCommand';
import { HeroScene } from '../ui/HeroScene';
import { StepCheck, StepDecide, StepPaste, VerdictChip } from '../ui/landing-art';
import { LensText } from '../ui/LensText';
import { Loupe } from '../ui/Loupe';
import { Penciled } from '../ui/Mark';
import { RepoForm } from '../ui/RepoForm';
import { SampleReel } from '../ui/SampleReel';
import { SourceFrames } from '../ui/SourceFrames';
import type { Source } from '../ui/reel-model';
import { getDb } from '../server/db';
import { listApproved } from '../server/store';
import film from '../ui/film.module.css';
import pill from '../ui/pill.module.css';
import styles from './landing.module.css';

// The sample reel is read from the API on each visit, so this page is never prerendered.
export const dynamic = 'force-dynamic';

const REPOSITORY = 'https://github.com/RaYYeR220/dailies';

/** The evidence example: one narration line and the two things in the record it rests on. */
const EXAMPLE: Source[] = [
  { kind: 'entry', role: 'entry', where: 'session 3 · entry 209 · 02:12', quote: null, body: 'Edit src/webhooks/send.ts   +18 −4' },
  {
    kind: 'diff', path: 'src/webhooks/send.ts', sha: '8c41f2e', added: null, removed: null, quote: 'attempt < 4',
    hunk: [
      "-  const res = await fetch(url, { method: 'POST', body });",
      "-  if (!res.ok) throw new Error('webhook failed');",
      '+  for (let attempt = 0; attempt < 4; attempt++) {',
      "+    const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000) });",
      '+    if (res.ok) return;',
      '+    await sleep(250 * 2 ** attempt);',
      '+  }',
      '+  throw new WebhookError(url, 4);',
    ].join('\n'),
  },
];

const VERDICTS = [
  { kind: 'ring', name: 'Verified', says: 'The record shows it.' },
  { kind: 'cross', name: 'Contradicted', says: 'The record shows otherwise.' },
  { kind: 'dashed', name: 'Stale', says: 'The code was edited after the last passing run.' },
  { kind: 'question', name: 'Unverified', says: 'Nothing in the record either way.' },
] as const;

/** The reel the landing shows: the one the deployment names, or else the reel a person approved last. */
function featuredRun(): string | undefined {
  // NEXT_PUBLIC_ values are fixed when the image is built; DAILIES_FEATURED_RUN is read when the page is asked for.
  const named = process.env.DAILIES_FEATURED_RUN || process.env.NEXT_PUBLIC_FEATURED_RUN;
  if (named) return named;
  try {
    return listApproved(getDb(), 1)[0]?.runId;
  } catch {
    return undefined;
  }
}

export default function Landing() {
  const featured = featuredRun();

  return (
    <>
      <main className={styles.main}>
        <section className={styles.hero} id="top">
          <header className={styles.nav}>
            <Link className={styles.wordmark} href="/">Dailies</Link>
            <Link className={`${pill.btn} ${pill.quiet}`} href="/gallery">Gallery</Link>
          </header>
          <div className={styles.stage}>
            <HeroScene className={styles.scene} />
          </div>
          <div className={styles.claim}>
            <h1>
              <span>Your agents</span>
              <span>worked all night.</span>
              <span className={styles.cut}>Watch the cut.</span>
            </h1>
            <p className={styles.sub}>A 60-second reel of what your coding agents did, checked against what they actually ran.</p>
            <RepoForm />
          </div>
        </section>

        {featured ? <SampleReel runId={featured} /> : null}

        <section className={`${styles.sec} ${styles.night}`}>
          <div className={styles.wrap}>
            <h2>How it reads the night</h2>
          </div>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <figure><StepPaste /></figure>
              <div className={styles.cap}>
                <h3>Paste a repo</h3>
                <p>Dailies reads last night’s Entire checkpoints: every prompt, command, edit and message.</p>
              </div>
            </li>
            <li className={styles.step}>
              <figure><StepCheck /></figure>
              <div className={styles.cap}>
                <h3>The agent checks every claim</h3>
                <p>Each thing an agent said is held against what was actually run. Nothing goes into the reel on its word alone.</p>
              </div>
            </li>
            <li className={styles.step}>
              <figure><StepDecide /></figure>
              <div className={styles.cap}>
                <h3>You watch, then decide</h3>
                <p>Watch the reel, ask for changes in your own words, and approve it when it is right.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className={`${styles.sec} ${styles.source}`}>
          <div className={styles.wrap}>
            <h2>Every sentence has a source</h2>
            <p className={styles.lede}>
              Put the loupe on any line of the narration and it opens to what it rests on: the transcript entry and the patch. A line with nothing behind it is not narrated as fact.
            </p>
            <div className={styles.srcGrid}>
              <div className={styles.srcClaim}>
                <p className={styles.time}>0:27</p>
                <p className={styles.line}>
                  The sender now <Penciled mark="ring" seed={21} weight={3.6} label="verified">retries 4 times</Penciled> and waits longer after each attempt.
                </p>
                <Loupe className={styles.srcLoupe} label="Under the loupe: the loop condition, attempt < 4, ringed in pencil.">
                  <LensText focus="attempt < 4" above="if (!res.ok) throw new Error('webhook failed');" below="const res = await fetch(url, { method: 'POST'," seed={4} />
                </Loupe>
              </div>
              <div className={`${film.film} ${styles.srcFilm}`}>
                <SourceFrames sources={EXAMPLE} />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.sec}>
          <div className={styles.wrap}>
            <h2>Four verdicts</h2>
            <p className={styles.lede}>Every claim an agent made leaves the night with one of four pencil marks.</p>
            <ul className={styles.verdicts}>
              {VERDICTS.map((v) => (
                <li key={v.kind}>
                  <VerdictChip kind={v.kind} />
                  <h3>{v.name}</h3>
                  <p>{v.says}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.sec}>
          <div className={`${styles.wrap} ${styles.cli}`}>
            <div>
              <h2>Runs where your agents run</h2>
              <p className={styles.lede}>Dailies is a plugin for the Entire CLI.</p>
            </div>
            <CopyCommand command="entire dailies run ." />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.foot}`}>
          <Link className={styles.wordmark} href="/">Dailies</Link>
          <p>Verification rests on what the session recorded.</p>
          <a className={`${pill.btn} ${pill.quiet}`} href={REPOSITORY}>GitHub</a>
        </div>
      </footer>
    </>
  );
}

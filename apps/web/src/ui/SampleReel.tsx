import Link from 'next/link';
import { fetchReel } from './api';
import { SamplePlayer } from './SamplePlayer';
import styles from './SampleReel.module.css';

/**
 * The landing's sample: the reel of the run named by NEXT_PUBLIC_FEATURED_RUN, read through the API like
 * any other reel. When that run cannot be shown, the section is left out rather than shown broken.
 */
export async function SampleReel({ runId }: { runId: string }) {
  const reel = await fetchReel(runId).catch((err: unknown) => {
    console.warn(`featured run ${runId} could not be read, so the landing shows no sample reel:`, err);
    return null;
  });
  if (!reel?.storyboard || !reel.media.video) return null;

  return (
    <section className={styles.sec} id="reel">
      <div className={styles.grid}>
        <div className={styles.copy}>
          <h2>What you get</h2>
          <p>
            A reel about a minute long. It opens on the problem you set, walks through the key decisions and the implementation, and ends on the validation that was actually recorded.
          </p>
          <Link className={styles.more} href={`/reel/${reel.run.id}`}>Open this reel with its sources</Link>
        </div>
        <SamplePlayer data={reel} />
      </div>
    </section>
  );
}

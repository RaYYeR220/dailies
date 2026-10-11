import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchApproved } from '../../ui/api';
import { repoName, shortDate } from '../../ui/format';
import pill from '../../ui/pill.module.css';
import shell from '../shell.module.css';
import styles from './gallery.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Gallery' };

export default async function Gallery() {
  const reels = await fetchApproved();

  return (
    <div className={shell.app}>
      <div className={shell.page}>
        <header className={styles.top}>
          <Link className={shell.wordmark} href="/">Dailies</Link>
          <h1>Gallery</h1>
          <span className={styles.count}>
            {reels.length === 0 ? 'no approved reels yet' : `${reels.length} approved ${reels.length === 1 ? 'reel' : 'reels'}, newest first`}
          </span>
        </header>

        {reels.length === 0 ? (
          <main className={styles.empty}>
            <h2>Nothing has been approved yet.</h2>
            <p>A reel appears here once a person has watched it and approved it. Paste a repo, watch the cut, and yours is the first frame on this sheet.</p>
            <Link className={`${pill.btn} ${pill.go}`} href="/">Paste a repo</Link>
          </main>
        ) : (
          <main>
            <ol className={styles.sheet}>
              {reels.map((reel, i) => (
                <li key={reel.runId}>
                  <Link className={styles.frame} href={`/reel/${reel.runId}`}>
                    <span className={styles.film}>
                      <span className={styles.edge} aria-hidden="true">{String(reels.length - i).padStart(2, '0')}</span>
                      {/* A plain img: the poster comes from the media route, and the caption beside it says what it is. */}
                      <img src={`/media/${reel.runId}/poster.png`} alt="" loading="lazy" width={640} height={360} />
                    </span>
                    <span className={styles.cap}>
                      <b>{repoName(reel.repoUrl)}</b>
                      <time dateTime={reel.approvedAt}>{shortDate(reel.approvedAt)}</time>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </main>
        )}
      </div>
    </div>
  );
}

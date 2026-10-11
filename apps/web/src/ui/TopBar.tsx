import Link from 'next/link';
import styles from './TopBar.module.css';

/** The head of a working page: where you are, which night, and what state it is in. */
export function TopBar({ repo, window, state, clock, live = false }: { repo: string; window: string; state: string; clock?: string | null; live?: boolean }) {
  return (
    <header className={styles.top}>
      <Link className={styles.wordmark} href="/">Dailies</Link>
      <div className={styles.crumb}>
        <h1>{repo}</h1>
        {window ? <span className={styles.win}>{window}</span> : null}
      </div>
      <span className={styles.state}>
        <i className={live ? styles.live : undefined} />
        <span>
          {state}
          {/* A clock that ticks every second is for the eye only. */}
          {clock ? <span aria-hidden="true">, {clock}</span> : null}
        </span>
      </span>
    </header>
  );
}

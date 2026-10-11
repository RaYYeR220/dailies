import Link from 'next/link';
import styles from './TopBar.module.css';

/** The head of a working page: where you are, which night, and what state it is in. */
export function TopBar({ repo, window, state, live = false }: { repo: string; window: string; state: string; live?: boolean }) {
  return (
    <header className={styles.top}>
      <Link className={styles.wordmark} href="/">Dailies</Link>
      <div className={styles.crumb}>
        <h1>{repo}</h1>
        {window ? <span className={styles.win}>{window}</span> : null}
      </div>
      <span className={styles.state} role="status">
        <i className={live ? styles.live : undefined} />
        {state}
      </span>
    </header>
  );
}

import Link from 'next/link';
import pill from '../ui/pill.module.css';
import shell from './shell.module.css';

export default function NotFound() {
  return (
    <div className={shell.app}>
      <main className={`${shell.page} ${shell.lost}`}>
        <Link className={shell.wordmark} href="/">Dailies</Link>
        <h1>There is nothing on this frame.</h1>
        <p>No run or reel has this address. It may have been mistyped, or the run may not have reached the stage that makes a reel.</p>
        <Link className={`${pill.btn} ${pill.go}`} href="/">Paste a repo</Link>
      </main>
    </div>
  );
}

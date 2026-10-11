'use client';

import Link from 'next/link';
import pill from '../ui/pill.module.css';
import shell from './shell.module.css';

export default function PageError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className={shell.app}>
      <main className={`${shell.page} ${shell.lost}`}>
        <Link className={shell.wordmark} href="/">Dailies</Link>
        <h1>This page could not be loaded.</h1>
        <p>The server did not return something this page can read. The run itself is not affected; load the page again in a moment.</p>
        <button type="button" className={pill.btn} onClick={() => retry()}>Load the page again</button>
      </main>
    </div>
  );
}

'use client';

import { useState } from 'react';
import pill from './pill.module.css';
import styles from './CopyCommand.module.css';

/** A shell command in a pill, with a button that copies it. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard access: the command is on screen and can be selected by hand.
    }
  }

  return (
    <div className={styles.cmd}>
      <span className={styles.prompt} aria-hidden="true">$</span>
      <code>{command}</code>
      <button type="button" className={`${pill.btn} ${styles.copy}`} onClick={copy}>
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeRepoInput, NOT_A_REPO, refusalInWords } from './run-model';
import pill from './pill.module.css';
import styles from './RepoForm.module.css';

/** The landing's one action: a repository address in, a run page out. */
export function RepoForm() {
  const router = useRouter();
  const noteId = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const repoUrl = normalizeRepoInput(value);
    if (!repoUrl) {
      setRefusal(value.trim() ? NOT_A_REPO : 'Paste the address of a GitHub repository first.');
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl }) });
      const body = (await res.json().catch(() => null)) as { runId?: string; error?: string; reason?: string } | null;
      if (res.status === 201 && body?.runId) {
        router.push(`/r/${body.runId}`);
        return;
      }
      setRefusal(refusalInWords(res.status, body));
    } catch {
      setRefusal('The server did not answer. Check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <form className={styles.form} onSubmit={start} noValidate>
      <div className={`${pill.field} ${styles.field}`}>
        <input
          type="text"
          inputMode="url"
          name="repo"
          aria-label="GitHub repository address"
          aria-describedby={noteId}
          aria-invalid={refusal ? true : undefined}
          placeholder="github.com/you/repo"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (refusal) setRefusal(null);
          }}
        />
        <button type="submit" className={`${pill.btn} ${pill.go} ${styles.go}`} disabled={busy}>
          {busy ? 'Starting the run' : 'Paste a repo'}
        </button>
      </div>
      <p id={noteId} className={`${styles.note} ${refusal ? styles.refused : ''}`} role={refusal ? 'alert' : undefined}>
        {refusal ?? 'Works on any public repo with Entire checkpoints.'}
      </p>
    </form>
  );
}

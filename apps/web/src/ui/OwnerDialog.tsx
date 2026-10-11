'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import pill from './pill.module.css';
import styles from './OwnerDialog.module.css';

export type OwnerAction = 'approve' | 'changes';

const TOKEN_KEY = 'dailies.ownerToken';
const FEEDBACK_MAX = 1000;

const stored = () => {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const keep = (token: string) => {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Session storage is unavailable: the token is asked for again next time.
  }
};

const APPROVE_REFUSALS: Record<number, string> = {
  401: 'That owner token was not accepted.',
  404: 'This run no longer exists.',
  409: 'This run is not waiting for approval, so there is nothing to approve.',
  503: 'Approval is switched off on this server: it has no owner token configured.',
};

export interface OwnerDialogProps {
  runId: string;
  /** What the person asked to do; null keeps the dialog closed. */
  action: OwnerAction | null;
  onClose(): void;
  onApproved(approvedAt: string | null): void;
  onChanges(recut: boolean, withToken: boolean): void;
}

/**
 * The two things a person does to a reel. Both need the owner token: it is asked for once and kept in
 * session storage, so the next action in this tab goes straight through.
 */
export function OwnerDialog({ runId, action, onClose, onApproved, onChanges }: OwnerDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [token, setToken] = useState('');
  const [askToken, setAskToken] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function approve(withToken: string): Promise<boolean> {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/reels/${runId}/approve`, { method: 'POST', headers: { 'x-owner-token': withToken } });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { approvedAt?: string } | null;
        keep(withToken);
        onApproved(body?.approvedAt ?? null);
        setBusy(false);
        return true;
      }
      if (res.status === 401) keep('');
      setRefusal(APPROVE_REFUSALS[res.status] ?? `The server answered with error ${res.status}.`);
    } catch {
      setRefusal('The server did not answer. Check your connection and try again.');
    }
    setBusy(false);
    return false;
  }

  // Opening: with a token already in this session, Approve goes straight through.
  useEffect(() => {
    if (!action) return;
    const known = stored();
    setToken(known);
    setAskToken(!known);
    setRefusal(null);
    if (action === 'approve' && known) {
      void approve(known).then((ok) => {
        if (ok) onClose();
        else {
          setToken('');
          setAskToken(true);
          dialog.current?.showModal();
        }
      });
      return;
    }
    dialog.current?.showModal();
    // Keyed on the action alone: this runs when the person asks for something, not when a callback changes identity.
  }, [action]);

  function close() {
    dialog.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (action === 'approve') {
      if (!token.trim()) {
        setRefusal('Enter the owner token to approve.');
        return;
      }
      if (await approve(token.trim())) close();
      return;
    }
    const note = text.trim();
    if (note.length < 1 || note.length > FEEDBACK_MAX) {
      setRefusal(`Write between 1 and ${FEEDBACK_MAX} characters.`);
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token.trim()) headers['x-owner-token'] = token.trim();
      const res = await fetch(`/api/reels/${runId}/feedback`, { method: 'POST', headers, body: JSON.stringify({ text: note }) });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { recut?: boolean } | null;
        if (body?.recut) keep(token.trim());
        onChanges(body?.recut === true, !!token.trim());
        setText('');
        setBusy(false);
        close();
        return;
      }
      setRefusal(res.status === 404 ? 'This run no longer exists.' : res.status === 400 ? `Write between 1 and ${FEEDBACK_MAX} characters.` : `The server answered with error ${res.status}.`);
    } catch {
      setRefusal('The server did not answer. Check your connection and try again.');
    }
    setBusy(false);
  }

  const approving = action === 'approve';

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <h2 id={titleId}>{approving ? 'Approve this reel' : 'Request changes'}</h2>
        <p className={styles.lede}>
          {approving
            ? 'Approving puts the reel in the gallery, where anyone can watch it.'
            : 'Say what should be different. The script is written again with your note, then voiced, rendered and checked.'}
        </p>

        {!approving ? (
          <label className={styles.label}>
            <span>What should change</span>
            <textarea
              value={text}
              maxLength={FEEDBACK_MAX}
              rows={5}
              required
              autoFocus
              placeholder="The second line undersells the failure. Say that two tests failed before the fix."
              onChange={(e) => setText(e.target.value)}
            />
            <small>{text.length} of {FEEDBACK_MAX}</small>
          </label>
        ) : null}

        {askToken ? (
          <label className={styles.label}>
            <span>Owner token</span>
            <input type="password" value={token} autoComplete="off" autoFocus={approving} spellCheck={false} onChange={(e) => setToken(e.target.value)} />
            <small>
              {approving
                ? 'Asked once. It stays in this tab until you close it.'
                : 'Optional. Without it your note is saved, but the reel is not cut again.'}
            </small>
          </label>
        ) : (
          <p className={styles.known}>Using the owner token from this tab.</p>
        )}

        <p className={styles.refusal} role="alert">{refusal}</p>

        <div className={styles.acts}>
          <button type="button" className={pill.btn} onClick={close}>Cancel</button>
          <button type="submit" className={`${pill.btn} ${pill.go}`} disabled={busy}>
            {approving ? (busy ? 'Approving' : 'Approve') : busy ? 'Sending' : 'Request changes'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

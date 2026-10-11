import type { ReactNode } from 'react';
import { Penciled } from './Mark';
import type { Mark } from './model';
import type { Source } from './reel-model';
import film from './film.module.css';

const HUNK_LINES = 16;
type RingMark = Exclude<Mark, 'question'>;

/** The text with the quoted span marked in pencil where it first occurs. */
function withQuote(text: string, quote: string | null, mark: RingMark, seed: number): ReactNode {
  const at = quote ? text.indexOf(quote) : -1;
  if (at === -1 || !quote) return text;
  return (
    <>
      {text.slice(0, at)}
      <Penciled mark={mark} seed={seed} weight={2.3}>{quote}</Penciled>
      {text.slice(at + quote.length)}
    </>
  );
}

function Hunk({ hunk, quote, mark, path }: { hunk: string; quote: string | null; mark: RingMark; path: string }) {
  const all = hunk.split('\n').filter((l) => !l.startsWith('@@'));
  const lines = all.slice(0, HUNK_LINES);
  let ringed = false;
  return (
    <>
      <pre className={film.hunk} aria-label={`Patch of ${path}`}>
        {lines.map((line, i) => {
          const sign = line[0] === '+' ? '+' : line[0] === '-' ? '−' : ' ';
          const body = line.slice(1);
          const here = !ringed && sign !== '−' && !!quote && body.includes(quote);
          if (here) ringed = true;
          return (
            <span key={i} className={`${film.ln} ${sign === '+' ? film.add : sign === '−' ? film.del : film.ctx}`}>
              <span>{sign}</span>
              <span>{here ? withQuote(body, quote, mark, 7 + i) : body}</span>
            </span>
          );
        })}
      </pre>
      {all.length > lines.length ? <p className={film.more}>and {all.length - lines.length} more lines in the commit</p> : null}
    </>
  );
}

const ROLE_WORD = { prompt: 'prompt', command: '$', agent: 'agent', entry: '' } as const;

export interface SourceFramesProps {
  sources: Source[];
  /** The mark of the line these sources belong to: a ring on a grounded line, a cross on a flagged one. */
  mark?: Mark;
  /** Commit URL for a diff source, when there is one. */
  hrefFor?: (source: Source) => string | null;
}

/** What a narration line rests on, one lit frame per source. */
export function SourceFrames({ sources, mark = 'ring', hrefFor }: SourceFramesProps) {
  const ring: RingMark = mark === 'question' ? 'ring' : mark;
  return (
    <>
      {sources.map((source, i) => {
        if (source.kind === 'stat') {
          return (
            <div key={i} className={`${film.frame} ${film.lit}`}>
              <p className={film.head}><b>Recorded count</b><span>{source.key}</span></p>
              {source.value === null ? (
                <p className={film.quiet}>This count is not part of the reel data.</p>
              ) : (
                <p className={film.stat}><b>{source.value}</b><span>{source.label}</span></p>
              )}
            </div>
          );
        }
        if (source.kind === 'diff') {
          const href = hrefFor?.(source) ?? null;
          return (
            <div key={i} className={`${film.frame} ${film.lit}`}>
              <p className={film.head}>
                <b>Patch</b>
                <span>
                  {source.path}
                  {source.added !== null && source.removed !== null ? `  +${source.added} −${source.removed}` : ''}
                </span>
              </p>
              {source.hunk ? (
                <Hunk hunk={source.hunk} quote={source.quote} mark={ring} path={source.path} />
              ) : source.quote ? (
                <p className={film.entry}>{source.quote}</p>
              ) : (
                <p className={film.quiet}>The patch is in the commit.</p>
              )}
              {href ? (
                <a className={film.commit} href={href} target="_blank" rel="noopener noreferrer">
                  Open commit {source.sha.slice(0, 7)} on GitHub
                </a>
              ) : null}
            </div>
          );
        }
        const body = source.body ?? source.quote;
        return (
          <div key={i} className={`${film.frame} ${film.lit}`}>
            <p className={film.head}><b>Transcript entry</b><span>{source.where}</span></p>
            {source.role === 'command' && source.command ? (
              <p className={film.entry}><span className={film.dim}>$ </span>{source.command}</p>
            ) : null}
            {body ? (
              <p className={film.entry}>
                {source.role === 'prompt' || source.role === 'agent' ? <span className={film.dim}>{ROLE_WORD[source.role]} </span> : null}
                {withQuote(body.trim(), source.body ? source.quote : null, ring, 11 + i)}
              </p>
            ) : (
              <p className={film.quiet}>The text of this entry is not part of the reel data.</p>
            )}
          </div>
        );
      })}
    </>
  );
}

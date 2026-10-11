import { entryId, redact, type Entry } from '@dailies/core';

const MAX_ENTRIES = 5000;
const TOOL_OUTPUT_LIMIT = 8000;
const TOOL_OUTPUT_HEAD = 3000;
const TOOL_OUTPUT_TAIL = 5000;
const TOOL_INPUT_LIMIT = 4000;
// Larger than any realistic single secret match (a PEM block included), so a secret sitting
// right at a truncation cut is still fully visible to redact() before that cut is made.
const SAFETY_MARGIN = 8192;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// redact()'s private_key rule needs a literal "-----END ... PRIVATE KEY-----" to match; a window
// edge can cut that marker off. Catch a BEGIN with no matching END in the same window and redact
// from it to the window's end, so a key is never left exposed just because it is unterminated here.
const UNTERMINATED_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z ]*PRIVATE KEY-----)[\s\S]*$/;

/** redact(), plus a defensive catch for a private key left unterminated by a truncation window. */
export function redactBounded(text: string): { text: string; hits: number } {
  const r = redact(text);
  if (!UNTERMINATED_PRIVATE_KEY_RE.test(r.text)) return r;
  return { text: r.text.replace(UNTERMINATED_PRIVATE_KEY_RE, '[REDACTED:private_key]'), hits: r.hits + 1 };
}

/** Redacts, then truncates to head+tail — redacting first so a secret can't survive by straddling
 * the cut; bounding the pre-redaction window first so redact() never scans an unbounded string. */
function redactAndTruncateOutput(text: string): { text: string; hits: number } {
  if (text.length <= TOOL_OUTPUT_LIMIT) return redactBounded(text);

  const windowSize = TOOL_OUTPUT_HEAD + SAFETY_MARGIN + TOOL_OUTPUT_TAIL + SAFETY_MARGIN;
  if (text.length <= windowSize) {
    const r = redactBounded(text);
    return { text: `${r.text.slice(0, TOOL_OUTPUT_HEAD)}\n…[truncated]…\n${r.text.slice(-TOOL_OUTPUT_TAIL)}`, hits: r.hits };
  }

  const headWindow = text.slice(0, TOOL_OUTPUT_HEAD + SAFETY_MARGIN);
  const tailWindow = text.slice(-(TOOL_OUTPUT_TAIL + SAFETY_MARGIN));
  const redactedHead = redactBounded(headWindow);
  const redactedTail = redactBounded(tailWindow);
  return {
    text: `${redactedHead.text.slice(0, TOOL_OUTPUT_HEAD)}\n…[truncated]…\n${redactedTail.text.slice(-TOOL_OUTPUT_TAIL)}`,
    hits: redactedHead.hits + redactedTail.hits,
  };
}

function redactAndTruncateInput(inputJson: string): { text: string; hits: number } {
  const bounded = inputJson.length <= TOOL_INPUT_LIMIT + SAFETY_MARGIN ? inputJson : inputJson.slice(0, TOOL_INPUT_LIMIT + SAFETY_MARGIN);
  const r = redactBounded(bounded);
  return { text: r.text.slice(0, TOOL_INPUT_LIMIT), hits: r.hits };
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
  result?: { output?: string; status?: string };
}

interface TextBlock {
  type?: string;
  id?: string;
  text?: string;
}

type Block = ToolUseBlock | TextBlock;

interface TranscriptLine {
  type?: string;
  ts?: string;
  content?: Block[];
}

/** Parses one session's `transcript.jsonl` into typed entries. A malformed line is skipped, not fatal. */
export function parseTranscript(sessionId: string, jsonl: string): { entries: Entry[]; redactions: number } {
  const entries: Entry[] = [];
  let redactions = 0;
  let index = 0;

  const pushEntry = (partial: Omit<Entry, 'id' | 'sessionId' | 'index'>) => {
    if (entries.length >= MAX_ENTRIES) return;
    entries.push({ id: entryId(sessionId, index), sessionId, index, ...partial });
    index += 1;
  };

  for (const rawLine of jsonl.split('\n')) {
    if (entries.length >= MAX_ENTRIES) break;
    const line = rawLine.trim();
    if (!line) continue;

    let msg: TranscriptLine;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (!msg || typeof msg !== 'object') continue;

    const ts: string | null = typeof msg.ts === 'string' ? msg.ts : null;
    const content = Array.isArray(msg.content) ? msg.content : [];

    if (msg.type === 'user') {
      for (const block of content as TextBlock[]) {
        if (!block || block.type === 'image') continue;
        if (typeof block.text !== 'string') continue;
        const r = redact(block.text);
        redactions += r.hits;
        pushEntry({ ts, kind: 'user', text: r.text });
      }
    } else if (msg.type === 'assistant') {
      for (const block of content) {
        if (!block || (block as TextBlock).type === 'image') continue;

        if ((block as ToolUseBlock).type === 'tool_use') {
          const toolUse = block as ToolUseBlock;
          const input = toolUse.input ?? {};
          const command = typeof input.command === 'string' ? input.command : undefined;
          const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;

          const redactedCommand = command !== undefined ? redact(command) : null;
          if (redactedCommand) redactions += redactedCommand.hits;

          const inputJson = JSON.stringify(input);
          const redactedInput = redactAndTruncateInput(inputJson);
          redactions += redactedInput.hits;
          const text = redactedInput.text;

          pushEntry({
            ts,
            kind: 'tool_call',
            text,
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            ...(redactedCommand ? { command: redactedCommand.text } : {}),
            ...(filePath !== undefined ? { filePath } : {}),
          });

          if (toolUse.result) {
            const stripped = stripAnsi(toolUse.result.output ?? '');
            const redactedOutput = redactAndTruncateOutput(stripped);
            redactions += redactedOutput.hits;
            const text = redactedOutput.text;
            pushEntry({
              ts,
              kind: 'tool_result',
              text,
              toolName: toolUse.name,
              toolUseId: toolUse.id,
              isError: toolUse.result.status !== 'success',
            });
          }
        } else if ((block as TextBlock).type === 'text' && typeof (block as TextBlock).text === 'string') {
          const r = redact((block as TextBlock).text!);
          redactions += r.hits;
          pushEntry({ ts, kind: 'assistant', text: r.text });
        }
      }
    }
  }

  return { entries, redactions };
}

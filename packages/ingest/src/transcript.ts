import { entryId, redact, type Entry } from '@dailies/core';

const MAX_ENTRIES = 5000;
const TOOL_OUTPUT_LIMIT = 8000;
const TOOL_OUTPUT_HEAD = 3000;
const TOOL_OUTPUT_TAIL = 5000;
const TOOL_INPUT_LIMIT = 4000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function truncateToolOutput(text: string): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= TOOL_OUTPUT_LIMIT) return stripped;
  return `${stripped.slice(0, TOOL_OUTPUT_HEAD)}\n…[truncated]…\n${stripped.slice(-TOOL_OUTPUT_TAIL)}`;
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

          const inputJson = JSON.stringify(input).slice(0, TOOL_INPUT_LIMIT);
          const redactedInput = redact(inputJson);
          redactions += redactedInput.hits;

          pushEntry({
            ts,
            kind: 'tool_call',
            text: redactedInput.text,
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            ...(redactedCommand ? { command: redactedCommand.text } : {}),
            ...(filePath !== undefined ? { filePath } : {}),
          });

          if (toolUse.result) {
            const truncated = truncateToolOutput(toolUse.result.output ?? '');
            const redactedOutput = redact(truncated);
            redactions += redactedOutput.hits;
            pushEntry({
              ts,
              kind: 'tool_result',
              text: redactedOutput.text,
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

export type CommandClass = 'test' | 'build' | 'typecheck' | 'lint' | 'other';

const PM = '(?:npm|pnpm|yarn|bun)';

const TEST_PATTERNS = [
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bmocha\b/,
  /\bplaywright\s+test\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bdotnet\s+test\b/,
  /\brspec\b/,
  /\bphpunit\b/,
  /\bpython\s+-m\s+unittest\b/,
  new RegExp(`\\b${PM}\\s+(?:run\\s+)?test\\b`),
  /\bmake\s+test\b/,
];

const TYPECHECK_PATTERNS = [
  /\btsc\b/,
  /\bmypy\b/,
  /\bpyright\b/,
  new RegExp(`\\b${PM}\\s+(?:run\\s+)?type-?check\\b`),
  new RegExp(`\\b${PM}\\s+(?:run\\s+)?check-types\\b`),
];

const LINT_PATTERNS = [
  /\beslint\b/,
  /\bbiome\b/,
  /\bruff\b/,
  /\bflake8\b/,
  new RegExp(`\\b${PM}\\s+(?:run\\s+)?lint\\b`),
];

const BUILD_PATTERNS = [
  new RegExp(`\\b${PM}\\s+(?:run\\s+)?build\\b`),
  /\bnext\s+build\b/,
  /\bvite\s+build\b/,
  /\bcargo\s+build\b/,
  /\bgo\s+build\b/,
  /\bmake\b/,
];

const ORDER: [CommandClass, RegExp[]][] = [
  ['test', TEST_PATTERNS],
  ['typecheck', TYPECHECK_PATTERNS],
  ['lint', LINT_PATTERNS],
  ['build', BUILD_PATTERNS],
];

// A part that only reads, moves or records things is never a run, whatever its arguments mention:
// `git commit -m "add vitest coverage"`, `grep -rn AbortSignal node_modules/vitest`, `npm view vitest versions`.
const NOT_A_RUN = new Set([
  'git', 'grep', 'rg', 'ag', 'cat', 'sed', 'awk', 'ls', 'echo', 'printf', 'find', 'head', 'tail', 'wc', 'sort', 'uniq',
  'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'which', 'curl', 'wget', 'cd', 'pwd', 'jq', 'open', 'diff', 'tee', 'xargs',
  'kill', 'pkill', 'sleep', 'export', 'source', 'test', '[', 'true', 'false',
]);
const PM_NOT_A_RUN = new RegExp(`^${PM}\\s+(?:ls|list|view|info|show|install|i|ci|add|remove|rm|uninstall|audit|why|outdated|update|up|init|pkg|config|publish|pack|link|store|cache|dlx\\s+\\S*create)\\b`);
const ENV_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;

function classifyPart(part: string): CommandClass {
  const bare = part.replace(ENV_ASSIGNMENT, '');
  const head = bare.split(/\s+/, 1)[0] ?? '';
  if (NOT_A_RUN.has(head) || PM_NOT_A_RUN.test(bare)) return 'other';
  for (const [cls, patterns] of ORDER) {
    if (patterns.some((re) => re.test(bare))) return cls;
  }
  return 'other';
}

// The body of a here-document is text being written to a file, not commands.
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g;

export function classifyCommand(command: string): CommandClass {
  const parts = command.replace(HEREDOC, '').split(/&&|\|\||[;|\n]/).map((p) => p.trim()).filter(Boolean);
  const classes = new Set(parts.map(classifyPart));
  for (const [cls] of ORDER) {
    if (classes.has(cls)) return cls;
  }
  return 'other';
}

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
  /\bnpm\s+(?:install-test|it|cit|install-ci-test)\b/,
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
  'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod', 'which', 'curl', 'wget', 'cd', 'pwd', 'jq', 'open', 'diff', 'tee',
  'kill', 'pkill', 'sleep', 'export', 'test', '[', 'true', 'false',
]);
// `(?![\w-])` so that `npm install-test` and `npm it`, which do run the tests, are not taken for an install.
const PM_NOT_A_RUN = new RegExp(`^${PM}\\s+(?:ls|list|view|info|show|install|i|ci|add|remove|rm|uninstall|audit|why|outdated|update|up|init|pkg|config|publish|pack|link|store|cache)(?![\\w-])`);
const ENV_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
// Ways a harmless-looking command still runs another one: a substitution, `find -exec`, `git bisect run`,
// `git rebase --exec`. With any of these the part is judged by what it mentions, as before.
const RUNS_ANOTHER = /\$\(|`|\s-{1,2}exec(?:dir)?\b|\bbisect\s+run\b/;

function classifyPart(part: string): CommandClass {
  const bare = part.replace(ENV_ASSIGNMENT, '');
  const head = bare.split(/\s+/, 1)[0] ?? '';
  if (!RUNS_ANOTHER.test(bare) && (NOT_A_RUN.has(head) || PM_NOT_A_RUN.test(bare))) return 'other';
  for (const [cls, patterns] of ORDER) {
    if (patterns.some((re) => re.test(bare))) return cls;
  }
  return 'other';
}

// The body of a here-document is text being written to a file or fed to a program, not commands, unless the
// program it is fed to is itself a shell (`bash <<EOF`, `ssh host <<EOF`): then the body is kept and read.
const HEREDOC = /^([^\n]*)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[^\n]*\n[\s\S]*?\n\s*\3\b/gm;
const FEEDS_A_SHELL = /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|ksh|fish|ssh|sudo|su|docker|kubectl|env|xargs)\b/;

function withoutHeredocBodies(command: string): string {
  return command.replace(HEREDOC, (whole: string, before: string) => (FEEDS_A_SHELL.test(before) ? whole : before));
}

/** The parts of a command line that the shell runs one after another or pipes together. */
export function commandParts(command: string): string[] {
  return withoutHeredocBodies(command).split(/&&|\|\||[;|\n]/).map((p) => p.trim().replace(ENV_ASSIGNMENT, '')).filter(Boolean);
}

export function classifyCommand(command: string): CommandClass {
  const classes = new Set(commandParts(command).map(classifyPart));
  for (const [cls] of ORDER) {
    if (classes.has(cls)) return cls;
  }
  return 'other';
}

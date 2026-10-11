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

const TYPECHECK_PATTERNS = [/\btsc\b/, /\bmypy\b/, /\bpyright\b/];

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

function classifyPart(part: string): CommandClass {
  for (const [cls, patterns] of ORDER) {
    if (patterns.some((re) => re.test(part))) return cls;
  }
  return 'other';
}

export function classifyCommand(command: string): CommandClass {
  const parts = command.split(/&&|\|\||[;|]/).map((p) => p.trim());
  const classes = new Set(parts.map(classifyPart));
  for (const [cls] of ORDER) {
    if (classes.has(cls)) return cls;
  }
  return 'other';
}

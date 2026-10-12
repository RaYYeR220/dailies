const RULES: [string, RegExp][] = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['bearer', /(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/g],
  ['provider_key', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['aws_key_id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google_key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['assignment', /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*["']?)([^\s"'\[]{8,})/g],
];

// A user's home directory: the owner's name is itself an identifying string, worth hiding from a terminal
// scene the same way a secret is, but it is not a secret hit (the gate's secret check must stay unaffected).
// The name stops at a path separator, whitespace, or a character that can only be a structural delimiter
// around it (a quote, a colon, a bracket) — never part of an account name. That alone is not enough: a
// name directly concatenated with no delimiter at all (no quote, no space) could still run on, since a
// hyphen is a legal name character — straight through a "-----BEGIN ... PRIVATE KEY-----" marker, erasing
// the literal text @dailies/ingest's unterminated-private-key fallback looks for and leaving the key itself
// unredacted. The lookahead stops the name one character before that marker regardless of what precedes it.
const NAME = /(?:(?!-----BEGIN )[^/\\\s"'`<>|,;:=(){}[\]]){1,255}/.source;
const HOME_DIR = new RegExp(`/Users/${NAME}|/home/${NAME}|[A-Za-z]:\\\\Users\\\\${NAME}`, 'g');
const TRAILING_PUNCT = /[.,;:!?'")\]}]+$/;

export function redact(input: string): { text: string; hits: number; homePaths: number } {
  let hits = 0; let text = input;
  for (const [kind, re] of RULES) {
    text = text.replace(re, (...m) => {
      hits += 1;
      const keep = kind === 'bearer' || kind === 'assignment' ? (m[1] as string) : '';
      return `${keep}[REDACTED:${kind}]`;
    });
  }
  let homePaths = 0;
  text = text.replace(HOME_DIR, (match) => {
    homePaths += 1;
    const trail = TRAILING_PUNCT.exec(match)?.[0] ?? '';
    return `~${trail}`;
  });
  return { text, hits, homePaths };
}

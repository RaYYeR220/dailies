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
// The name itself is unconstrained (dotted, unicode and email-shaped account names all occur in the wild), so a
// trailing character that could only be sentence punctuation around the path — never part of it — is trimmed
// back out of the match rather than carried into the replacement.
const HOME_DIR = /\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+/g;
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

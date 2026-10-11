const BANNED_PHRASES = [
  'delve',
  'seamless',
  'robust',
  'leverage',
  'cutting-edge',
  'game-changer',
  'dive into',
  'unleash',
  'supercharge',
  'effortless',
  'revolutioniz',
  "it's worth noting",
  'not just',
];

const NUMBER_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];

const NUMBER_WORD_RE = new RegExp(`\\b(?:${NUMBER_WORDS.join('|')})\\b`, 'i');

export function lintStyle(text: string): string[] {
  const reasons: string[] = [];

  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 1) reasons.push('more than one sentence');

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 26) reasons.push('more than 26 words');

  if (/[—!]/.test(text)) reasons.push('contains an em dash or an exclamation mark');

  if (NUMBER_WORD_RE.test(text)) reasons.push('spells out a number instead of using a digit');

  for (const phrase of BANNED_PHRASES) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) reasons.push(`banned phrase: ${phrase}`);
  }

  return reasons;
}

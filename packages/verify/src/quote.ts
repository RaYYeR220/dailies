export function normalize(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

export function quoteMatches(quote: string, text: string): boolean {
  return normalize(text).includes(normalize(quote));
}

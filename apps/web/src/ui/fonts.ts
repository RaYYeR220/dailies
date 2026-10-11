import localFont from 'next/font/local';

// Self-hosted so a build needs no network and a visit makes no third-party request. See fonts/OFL.txt.
export const unbounded = localFont({ src: './fonts/unbounded-latin.woff2', weight: '200 900', variable: '--font-unbounded', display: 'swap' });

export const figtree = localFont({ src: './fonts/figtree-latin.woff2', weight: '300 900', variable: '--font-figtree', display: 'swap' });

export const martianMono = localFont({
  src: './fonts/martian-mono-latin.woff2',
  weight: '100 800',
  variable: '--font-martian',
  display: 'swap',
  // The width axis: code is set condensed (75%), labels at normal width.
  declarations: [{ prop: 'font-stretch', value: '75% 112.5%' }],
});

export const fontVariables = `${unbounded.variable} ${figtree.variable} ${martianMono.variable}`;

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontVariables } from '../ui/fonts';
import { LoupeDefs } from '../ui/Loupe';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Dailies: your agents worked all night. Watch the cut.', template: '%s | Dailies' },
  description: 'A 60-second reel of what your coding agents did, checked against what they actually ran.',
};

export const viewport: Viewport = { themeColor: '#0d1211', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <LoupeDefs />
        {children}
      </body>
    </html>
  );
}

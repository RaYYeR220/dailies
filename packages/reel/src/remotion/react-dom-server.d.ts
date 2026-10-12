// The types of react-dom are not among this package's dependencies. marks.tsx needs one function of it.
declare module 'react-dom/server' {
  import type { ReactNode } from 'react';
  export function renderToStaticMarkup(element: ReactNode): string;
}

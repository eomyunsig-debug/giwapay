import type { ReactNode } from 'react';

export function Bilingual({
  ko,
  en,
  as = 'span',
}: {
  ko: ReactNode;
  en: ReactNode;
  as?: 'span' | 'div';
}) {
  const Element = as;
  return (
    <Element>
      <span className="lang-ko">{ko}</span>
      <span className="lang-en">{en}</span>
    </Element>
  );
}

'use client';

import { useEffect, useSyncExternalStore } from 'react';

type Locale = 'en' | 'ko';

const storageKey = 'giwapay.showcase.locale';
const localeChangeEvent = 'giwapay-showcase-locale';

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.showcaseLocale = locale;
}

function getLocale(): Locale {
  return window.localStorage.getItem(storageKey) === 'ko' ? 'ko' : 'en';
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(localeChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(localeChangeEvent, onStoreChange);
  };
}

export function LanguageToggle() {
  const locale = useSyncExternalStore<Locale>(subscribe, getLocale, () => 'en');

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const selectLocale = (next: Locale) => {
    window.localStorage.setItem(storageKey, next);
    applyLocale(next);
    window.dispatchEvent(new Event(localeChangeEvent));
  };

  return (
    <div className="language-toggle" role="group" aria-label="Language / 언어 선택">
      <button type="button" aria-pressed={locale === 'en'} onClick={() => selectLocale('en')}>
        ENGLISH
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={locale === 'ko'} onClick={() => selectLocale('ko')}>
        한국어
      </button>
    </div>
  );
}

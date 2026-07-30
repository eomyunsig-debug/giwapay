'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type GiwaPayLocale = 'ko' | 'en';

const localeEvent = 'giwapay:locale';
const subscribe = (listener: () => void) => {
  window.addEventListener(localeEvent, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(localeEvent, listener);
    window.removeEventListener('storage', listener);
  };
};
const getLocale = (): GiwaPayLocale =>
  window.localStorage.getItem('giwapay.locale') === 'en' ? 'en' : 'ko';

export function useGiwaPayLocale(): GiwaPayLocale {
  return useSyncExternalStore(subscribe, getLocale, () => 'ko');
}

export function LanguageToggle() {
  const locale = useGiwaPayLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const selectLocale = (next: GiwaPayLocale) => {
    document.documentElement.lang = next;
    document.documentElement.dataset.locale = next;
    window.localStorage.setItem('giwapay.locale', next);
    window.dispatchEvent(new Event(localeEvent));
  };

  return (
    <div className="language-toggle" role="group" aria-label="Language / 언어">
      <button
        type="button"
        data-active={locale === 'en'}
        aria-pressed={locale === 'en'}
        onClick={() => selectLocale('en')}
      >
        ENGLISH
      </button>
      <span aria-hidden="true">/</span>
      <button
        type="button"
        data-active={locale === 'ko'}
        aria-pressed={locale === 'ko'}
        onClick={() => selectLocale('ko')}
      >
        한국어
      </button>
    </div>
  );
}

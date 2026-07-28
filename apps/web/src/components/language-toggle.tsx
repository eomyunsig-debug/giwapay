'use client';

import { Languages } from 'lucide-react';
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

  const toggle = () => {
    const next = locale === 'ko' ? 'en' : 'ko';
    document.documentElement.lang = next;
    document.documentElement.dataset.locale = next;
    window.localStorage.setItem('giwapay.locale', next);
    window.dispatchEvent(new Event(localeEvent));
  };

  return (
    <button
      type="button"
      className="language-toggle"
      onClick={toggle}
      aria-label={locale === 'ko' ? 'Switch to English' : '한국어로 전환'}
    >
      <Languages size={15} aria-hidden="true" />
      {locale === 'ko' ? 'EN' : '한국어'}
    </button>
  );
}

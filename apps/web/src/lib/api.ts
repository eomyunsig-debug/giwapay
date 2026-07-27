'use client';

import { GiwaPayClient } from '@giwapay/sdk';

import { API_BASE_URL } from './config';

const getCsrfToken = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.sessionStorage.getItem('giwapay.csrf') ?? undefined;
};

export const giwaPayClient = new GiwaPayClient({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  getCsrfToken,
});

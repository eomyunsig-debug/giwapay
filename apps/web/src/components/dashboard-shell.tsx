'use client';

import {
  BookOpen,
  KeyRound,
  LayoutDashboard,
  Link2,
  RotateCcw,
  Settings,
  Split,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Bilingual } from './bilingual';
import { Brand } from './brand';
import { LanguageToggle, useGiwaPayLocale } from './language-toggle';
import { WalletButton } from './wallet-button';

const nav = [
  { href: '/dashboard', ko: '개요', en: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/onboarding', ko: '온보딩', en: 'Onboarding', icon: Store },
  { href: '/dashboard/payment-links', ko: '결제 링크', en: 'Payment links', icon: Link2 },
  { href: '/dashboard/splits', ko: '정산 분배', en: 'Settlement splits', icon: Split },
  { href: '/dashboard/api-keys', ko: 'API 키', en: 'API keys', icon: KeyRound },
  { href: '/dashboard/refunds', ko: '환불', en: 'Refunds', icon: RotateCcw },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locale = useGiwaPayLocale();
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <Brand compact />
        <nav className="sidebar-nav" aria-label="Merchant dashboard">
          {nav.map(({ href, ko, en, icon: Icon }) => (
            <Link
              href={href}
              className="sidebar-link"
              data-active={href === '/dashboard' ? pathname === href : pathname.startsWith(href)}
              aria-label={locale === 'ko' ? ko : en}
              key={href}
            >
              <Icon size={17} aria-hidden="true" />
              <Bilingual ko={ko} en={en} />
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/docs" className="sidebar-link">
            <BookOpen size={17} />
            <Bilingual ko="문서" en="Documentation" />
          </Link>
          <Link href="/dashboard/onboarding" className="sidebar-link">
            <Settings size={17} />
            <Bilingual ko="설정" en="Settings" />
          </Link>
          <div className="testnet-notice">
            <strong>
              <Bilingual ko="테스트넷 데모" en="Testnet demo" />
            </strong>
            <br />
            <Bilingual
              ko="Mock 토큰은 금전적 가치가 없습니다."
              en="Mock tokens have no monetary value."
            />
          </div>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-actions">
            <LanguageToggle />
            <WalletButton compact />
          </div>
        </header>
        <main className="dashboard-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

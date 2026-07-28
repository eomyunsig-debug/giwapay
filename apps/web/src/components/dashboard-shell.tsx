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

import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';
import { WalletButton } from './wallet-button';

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/onboarding', label: 'Onboarding', icon: Store },
  { href: '/dashboard/payment-links', label: 'Payment links', icon: Link2 },
  { href: '/dashboard/splits', label: 'Settlement splits', icon: Split },
  { href: '/dashboard/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/dashboard/refunds', label: 'Refunds', icon: RotateCcw },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <Brand compact />
        <nav className="sidebar-nav" aria-label="Merchant dashboard">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              href={href}
              className="sidebar-link"
              data-active={href === '/dashboard' ? pathname === href : pathname.startsWith(href)}
              key={href}
              aria-label={label}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/docs" className="sidebar-link">
            <BookOpen size={17} />
            <span>Documentation</span>
          </Link>
          <Link href="/dashboard/onboarding" className="sidebar-link">
            <Settings size={17} />
            <span>Settings</span>
          </Link>
          <div className="testnet-notice">
            <strong>Testnet demo</strong>
            <br />
            Mock tokens have no monetary value.
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

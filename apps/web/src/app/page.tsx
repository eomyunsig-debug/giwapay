import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Fingerprint,
  LockKeyhole,
  Route,
  ShieldCheck,
  Split,
} from 'lucide-react';
import Link from 'next/link';

import { Bilingual } from '@/components/bilingual';
import { Brand } from '@/components/brand';
import { LanguageToggle } from '@/components/language-toggle';

export default function HomePage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Brand />
        <nav className="site-nav" aria-label="Primary navigation">
          <a href="#how">
            <Bilingual ko="작동 방식" en="How it works" />
          </a>
          <Link href="/docs">
            <Bilingual ko="개발자 문서" en="Developers" />
          </Link>
          <a href="https://sepolia-explorer.giwa.io" target="_blank" rel="noreferrer">
            Explorer
          </a>
        </nav>
        <div className="header-actions">
          <LanguageToggle />
          <Link className="header-link" href="/login">
            <Bilingual ko="로그인" en="Sign in" />
          </Link>
          <Link className="header-link header-link--primary" href="/login">
            <Bilingual ko="시작하기" en="Get started" />
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className="hero">
          <div>
            <p className="eyebrow">GIWA Sepolia · Non-custodial orchestration</p>
            <h1>
              Pay with anything.
              <br />
              Settle <em>exactly.</em>
            </h1>
            <div className="hero-description">
              <Bilingual
                as="div"
                ko="사용자는 가진 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액으로 정산받는 GIWA 기반 비수탁 결제 레이어."
                en="A non-custodial payment layer on GIWA: customers pay with a supported asset, while merchants receive the exact token and amount they selected."
              />
            </div>
            <div className="hero-actions">
              <Link className="action-link action-link--primary" href="/login">
                <Bilingual ko="판매자 시작하기" en="Start accepting payments" />
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="action-link" href="/docs">
                <Bilingual ko="API 살펴보기" en="Explore the API" />
              </Link>
            </div>
            <div className="trust-line">
              <span>
                <Check size={13} /> Atomic settlement
              </span>
              <span>
                <Check size={13} /> Merchant-signed intents
              </span>
              <span>
                <Check size={13} /> Verifiable receipts
              </span>
            </div>
          </div>

          <div className="hero-product" aria-label="GiwaPay checkout preview">
            <div className="hero-halo" />
            <div className="checkout-preview">
              <div className="preview-inner">
                <div className="preview-top">
                  <div className="merchant-avatar">N</div>
                  <span className="secure-label">
                    <LockKeyhole size={11} /> Secure checkout
                  </span>
                </div>
                <p className="preview-title">Namu Studio requests</p>
                <p className="preview-amount">₩48,000</p>
                <p className="preview-description">Annual design toolkit · Testnet demo</p>
                <div className="preview-token">
                  <div className="token-identity">
                    <span className="token-symbol">A</span>
                    <span>
                      <strong>Pay with MockALT</strong>
                      <small>Estimated 12.44 MockALT</small>
                    </span>
                  </div>
                  <span aria-hidden="true">⌄</span>
                </div>
                <div className="preview-route">
                  <div className="route-node">
                    <span>You pay</span>
                    <strong>≤ 12.57 MockALT</strong>
                  </div>
                  <div className="route-line" />
                  <div className="route-node">
                    <span>Merchant receives</span>
                    <strong>48,000 MockKRW exact</strong>
                  </div>
                </div>
                <div className="preview-button">Connect wallet to pay</div>
                <p className="preview-caption">
                  Testnet demo · No real-value token or fiat settlement
                </p>
              </div>
            </div>
            <div className="floating-chip floating-chip--top">
              <span className="chip-icon">
                <ShieldCheck size={15} />
              </span>
              Exact output verified
            </div>
            <div className="floating-chip floating-chip--bottom">
              <span className="chip-icon">
                <Split size={15} />
              </span>
              Settlement split · 2 recipients
            </div>
          </div>
        </section>

        <section className="feature-band" id="how">
          <div className="feature-band-inner">
            <div className="section-heading">
              <h2>
                <Bilingual
                  ko="결제는 유연하게. 정산은 흔들림 없이."
                  en="Flexible at checkout. Precise at settlement."
                />
              </h2>
              <p>
                <Bilingual
                  ko="GiwaPay는 자금을 보관하지 않습니다. 하나의 트랜잭션 안에서 결제, 교환, 수수료, 분할 정산을 원자적으로 실행합니다."
                  en="GiwaPay never holds funds between transactions. Payment, swap, fee, and split settlement execute atomically."
                />
              </p>
            </div>
            <div className="feature-grid">
              <article className="feature-card">
                <span className="feature-number">01</span>
                <h3>
                  <Bilingual ko="서명된 결제 의도" en="Signed payment intent" />
                </h3>
                <p>
                  <Bilingual
                    ko="판매자가 지정한 토큰, 정확한 정산액, 수취인과 만료 시간을 EIP-712 서명으로 고정합니다."
                    en="EIP-712 fixes the settlement token, exact amount, registered recipients, and expiry."
                  />
                </p>
              </article>
              <article className="feature-card">
                <span className="feature-number">02</span>
                <h3>
                  <Bilingual ko="원자적 라우팅" en="Atomic routing" />
                </h3>
                <p>
                  <Bilingual
                    ko="직접 토큰 또는 허용된 exact-output 어댑터로 교환합니다. 부족한 출력은 전체 트랜잭션을 되돌립니다."
                    en="Use the settlement token directly or an allowlisted exact-output adapter. Insufficient output reverts everything."
                  />
                </p>
              </article>
              <article className="feature-card">
                <span className="feature-number">03</span>
                <h3>
                  <Bilingual ko="검증 후 성공" en="Verified before success" />
                </h3>
                <p>
                  <Bilingual
                    ko="지갑 전송만으로 성공 처리하지 않습니다. 독립 인덱서가 체인 이벤트를 확인한 뒤 영수증과 웹훅을 발행합니다."
                    en="A wallet submission is never enough. An independent indexer verifies the event before receipts and webhooks."
                  />
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="feature-band" style={{ paddingTop: 0 }}>
          <div className="feature-band-inner trust-line">
            <span>
              <Fingerprint size={14} /> EIP-4361 merchant sign-in
            </span>
            <span>
              <Route size={14} /> Code-hash checked adapters
            </span>
            <span>
              <CircleDollarSign size={14} /> Merchant-funded refunds
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

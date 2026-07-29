import { ArrowRight, Check, LockKeyhole } from 'lucide-react';
import Link from 'next/link';

import { Bilingual } from '@/components/bilingual';
import { Brand } from '@/components/brand';
import { LanguageToggle } from '@/components/language-toggle';
import { ProgressiveDisclosure } from '@/components/progressive-disclosure';

export default function HomePage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Brand />
        <div className="header-actions">
          <LanguageToggle />
          <Link className="header-link header-link--primary" href="/login">
            <Bilingual ko="로그인" en="Sign in" />
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section className="hero">
          <div>
            <p className="eyebrow">
              <Bilingual ko="GIWA Sepolia · 테스트넷 MVP" en="GIWA Sepolia · Testnet MVP" />
            </p>
            <h1>
              <Bilingual
                ko={
                  <>
                    결제는 자유롭게.
                    <br />
                    정산은 <em>정확하게.</em>
                  </>
                }
                en={
                  <>
                    Pay with anything.
                    <br />
                    Settle <em>exactly.</em>
                  </>
                }
              />
            </h1>
            <div className="hero-description">
              <Bilingual
                as="div"
                ko="고객은 지원 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액을 받습니다."
                en="Customers pay with a supported asset. Merchants receive the exact token and amount they chose."
              />
            </div>
            <div className="hero-actions">
              <Link className="action-link action-link--primary" href="/login">
                <Bilingual ko="결제 링크 만들기" en="Create a payment link" />
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="text-link" href="/docs">
                <Bilingual ko="개발자 문서" en="Developer docs" />
              </Link>
            </div>
            <div className="trust-line">
              <span>
                <Check size={13} /> <Bilingual ko="비수탁" en="Non-custodial" />
              </span>
              <span>
                <Check size={13} /> <Bilingual ko="정확한 정산" en="Exact settlement" />
              </span>
              <span>
                <Check size={13} /> <Bilingual ko="검증된 영수증" en="Verified receipt" />
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
                    <LockKeyhole size={11} /> <Bilingual ko="안전한 결제" en="Secure checkout" />
                  </span>
                </div>
                <p className="preview-title">
                  <Bilingual ko="Namu Studio 결제 요청" en="Namu Studio requests" />
                </p>
                <p className="preview-amount">48,000 MockKRW</p>
                <p className="preview-description">
                  <Bilingual
                    ko="연간 디자인 툴킷 · 테스트넷 데모"
                    en="Annual design toolkit · Testnet demo"
                  />
                </p>
                <div className="preview-token">
                  <div className="token-identity">
                    <span className="token-symbol">A</span>
                    <span>
                      <strong>
                        <Bilingual ko="MockALT로 결제" en="Pay with MockALT" />
                      </strong>
                      <small>
                        <Bilingual ko="예상 12.44 MockALT" en="Estimated 12.44 MockALT" />
                      </small>
                    </span>
                  </div>
                  <span aria-hidden="true">⌄</span>
                </div>
                <div className="preview-route">
                  <div className="route-node">
                    <span>
                      <Bilingual ko="최대 결제" en="You pay up to" />
                    </span>
                    <strong>≤ 12.57 MockALT</strong>
                  </div>
                  <div className="route-line" />
                  <div className="route-node">
                    <span>
                      <Bilingual ko="판매자 수령" en="Merchant receives" />
                    </span>
                    <strong>
                      <Bilingual ko="48,000 MockKRW 정확히" en="48,000 MockKRW exact" />
                    </strong>
                  </div>
                </div>
                <div className="preview-button">
                  <Bilingual ko="지갑 연결하고 결제" en="Connect wallet to pay" />
                </div>
                <p className="preview-caption">
                  <Bilingual
                    ko="테스트넷 데모 · 실제 가치가 없는 Mock 토큰"
                    en="Testnet demo · Mock tokens have no real-world value"
                  />
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flow-section" id="how">
          <div className="feature-band-inner">
            <div className="section-heading">
              <h2>
                <Bilingual ko="세 단계면 충분합니다." en="Three steps. That is it." />
              </h2>
              <p>
                <Bilingual
                  ko="링크를 만들고, 고객이 자산을 고르면, 온체인 검증 후 정산됩니다."
                  en="Create a link, let the customer choose an asset, and settle after onchain verification."
                />
              </p>
            </div>

            <ol className="quick-flow">
              <li>
                <span>1</span>
                <strong>
                  <Bilingual ko="금액 입력" en="Set the amount" />
                </strong>
              </li>
              <li>
                <span>2</span>
                <strong>
                  <Bilingual ko="결제 자산 선택" en="Choose an asset" />
                </strong>
              </li>
              <li>
                <span>3</span>
                <strong>
                  <Bilingual ko="검증 후 정산" en="Verify and settle" />
                </strong>
              </li>
            </ol>

            <ProgressiveDisclosure
              className="operations-disclosure"
              summary={
                <Bilingual ko="운영 원리와 보안 경계" en="How it works and security boundaries" />
              }
              description={
                <Bilingual
                  ko="서명, 원자적 라우팅, 인덱서 검증 상세"
                  en="Signing, atomic routing, and indexer verification"
                />
              }
            >
              <div className="feature-grid">
                <article className="feature-card">
                  <span className="feature-number">01</span>
                  <h3>
                    <Bilingual ko="판매자 서명" en="Merchant signed" />
                  </h3>
                  <p>
                    <Bilingual
                      ko="정산 토큰, 금액, 등록된 수령인과 만료를 EIP-712 서명에 고정합니다."
                      en="EIP-712 fixes the token, amount, registered recipients, and expiry."
                    />
                  </p>
                </article>
                <article className="feature-card">
                  <span className="feature-number">02</span>
                  <h3>
                    <Bilingual ko="원자적 실행" en="Atomic execution" />
                  </h3>
                  <p>
                    <Bilingual
                      ko="결제, 교환, 수수료, 분할 정산이 모두 실행되거나 모두 되돌아갑니다."
                      en="Payment, swap, fee, and split settlement all complete or all revert."
                    />
                  </p>
                </article>
                <article className="feature-card">
                  <span className="feature-number">03</span>
                  <h3>
                    <Bilingual ko="독립 검증" en="Independent verification" />
                  </h3>
                  <p>
                    <Bilingual
                      ko="체인 이벤트가 확인된 뒤에만 영수증과 웹훅을 성공으로 처리합니다."
                      en="Receipts and webhooks succeed only after the chain event is verified."
                    />
                  </p>
                </article>
              </div>
              <Link className="text-link disclosure-docs-link" href="/docs">
                <Bilingual ko="전체 기술 문서 보기" en="Read the full technical docs" />
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </ProgressiveDisclosure>
          </div>
        </section>
      </main>
    </div>
  );
}

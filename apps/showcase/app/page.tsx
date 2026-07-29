import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LanguageToggle } from './language-toggle';

export const metadata: Metadata = {
  title: 'GiwaPay — Public Testnet MVP Showcase',
  description: 'GiwaPay의 핵심 결제 경험과 검증 가능한 테스트넷 구현을 확인하세요.',
};

const github = 'https://github.com/eomyunsig-debug/giwapay';

function Bilingual({ en, ko }: { en: ReactNode; ko: ReactNode }) {
  return (
    <>
      <span className="copy-en">{en}</span>
      <span className="copy-ko">{ko}</span>
    </>
  );
}

export default function Home() {
  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="GiwaPay home / GiwaPay 홈">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>GiwaPay</span>
        </a>
        <div className="topbar-actions">
          <LanguageToggle />
          <a className="source-link" href={github} target="_blank" rel="noreferrer">
            <Bilingual en="View source" ko="소스 보기" />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="status-pill">
              <span aria-hidden="true" />
              <Bilingual en="GIWA Sepolia · Testnet MVP" ko="GIWA Sepolia · 테스트넷 MVP" />
            </p>
            <h1 id="hero-title">
              <Bilingual
                en={
                  <>
                    Pay with anything.
                    <br />
                    Settle <em>exactly.</em>
                  </>
                }
                ko={
                  <>
                    결제는 자유롭게.
                    <br />
                    정산은 <em>정확하게.</em>
                  </>
                }
              />
            </h1>
            <p className="hero-lede">
              <Bilingual
                en="Customers pay with a supported asset. Merchants receive the exact token and amount they chose."
                ko="고객은 지원 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액을 받습니다."
              />
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={github} target="_blank" rel="noreferrer">
                <Bilingual en="Explore the repository" ko="저장소 살펴보기" />
              </a>
              <a
                className="button button-secondary"
                href={`${github}/blob/main/docs/testing.md`}
                target="_blank"
                rel="noreferrer"
              >
                <Bilingual en="See verification" ko="검증 내용 보기" />
              </a>
            </div>
            <p className="scope-notice">
              <Bilingual
                en={
                  <>
                    <strong>Testnet demo.</strong> Public showcase only. Live GIWA Sepolia contracts
                    and payment execution are not deployed yet.
                  </>
                }
                ko={
                  <>
                    <strong>테스트넷 데모.</strong> 공개 쇼케이스 전용입니다. GIWA Sepolia
                    컨트랙트와 실제 결제 실행 환경은 아직 배포되지 않았습니다.
                  </>
                }
              />
            </p>
          </div>

          <aside
            className="checkout-preview"
            aria-label="Testnet checkout preview / 테스트넷 결제 미리보기"
          >
            <div className="preview-head">
              <span>
                <Bilingual en="TESTNET CHECKOUT PREVIEW" ko="테스트넷 결제 미리보기" />
              </span>
              <span>GIWA · 91342</span>
            </div>
            <div className="merchant-row">
              <span className="merchant-mark" aria-hidden="true">
                N
              </span>
              <span>
                <strong>Namu Studio</strong>
                <small>
                  <Bilingual en="Annual design toolkit" ko="연간 디자인 툴킷" />
                </small>
              </span>
            </div>
            <p className="preview-label">
              <Bilingual en="Merchant receives exactly" ko="판매자가 정확히 받는 금액" />
            </p>
            <p className="preview-amount">48,000 MockKRW</p>
            <div className="preview-row">
              <span>
                <Bilingual en="Customer pays with" ko="고객 결제 자산" />
              </span>
              <strong>MockALT</strong>
            </div>
            <div className="preview-row">
              <span>
                <Bilingual en="Maximum input" ko="최대 입력액" />
              </span>
              <strong>12.57 MockALT</strong>
            </div>
            <div className="preview-state">
              <span aria-hidden="true" />
              <Bilingual en="Preview only · No wallet action" ko="미리보기 전용 · 지갑 작업 없음" />
            </div>
          </aside>
        </section>

        <section className="flow-section" aria-labelledby="flow-title">
          <div className="section-heading">
            <p className="eyebrow">
              <Bilingual en="THE SIMPLE PATH" ko="간단한 결제 흐름" />
            </p>
            <h2 id="flow-title">
              <Bilingual en="Three steps. That is it." ko="세 단계면 충분합니다." />
            </h2>
            <p>
              <Bilingual
                en="Create a link, let the customer choose an asset, and settle after onchain verification."
                ko="링크를 만들고, 고객이 자산을 고르면, 온체인 검증 후 정산됩니다."
              />
            </p>
          </div>

          <ol className="quick-flow">
            <li>
              <span>1</span>
              <strong>
                <Bilingual en="Set the amount" ko="금액 입력" />
              </strong>
            </li>
            <li>
              <span>2</span>
              <strong>
                <Bilingual en="Choose an asset" ko="결제 자산 선택" />
              </strong>
            </li>
            <li>
              <span>3</span>
              <strong>
                <Bilingual en="Verify and settle" ko="검증 후 정산" />
              </strong>
            </li>
          </ol>

          <details className="operations-disclosure">
            <summary>
              <span>
                <strong>
                  <Bilingual en="How it works and security boundaries" ko="운영 원리와 보안 경계" />
                </strong>
                <small>
                  <Bilingual
                    en="Signing, atomic routing, verification, and scope"
                    ko="서명, 원자적 라우팅, 검증과 구현 범위"
                  />
                </small>
              </span>
            </summary>

            <div className="disclosure-body">
              <section aria-labelledby="operation-title">
                <p className="eyebrow">
                  <Bilingual en="HOW IT WORKS" ko="운영 원리" />
                </p>
                <h3 id="operation-title">
                  <Bilingual en="Verified before success." ko="검증된 뒤에만 성공합니다." />
                </h3>
                <div className="detail-grid">
                  <article>
                    <span>01</span>
                    <h4>
                      <Bilingual en="Merchant signed" ko="판매자 서명" />
                    </h4>
                    <p>
                      <Bilingual
                        en="EIP-712 fixes the token, amount, registered recipients, and expiry."
                        ko="정산 토큰, 금액, 등록 수령인과 만료를 EIP-712 서명에 고정합니다."
                      />
                    </p>
                  </article>
                  <article>
                    <span>02</span>
                    <h4>
                      <Bilingual en="Atomic execution" ko="원자적 실행" />
                    </h4>
                    <p>
                      <Bilingual
                        en="Payment, swap, fee, and split settlement all complete or all revert."
                        ko="결제, 교환, 수수료와 분할 정산이 모두 실행되거나 모두 되돌아갑니다."
                      />
                    </p>
                  </article>
                  <article>
                    <span>03</span>
                    <h4>
                      <Bilingual en="Independent verification" ko="독립 검증" />
                    </h4>
                    <p>
                      <Bilingual
                        en="Receipts and webhooks succeed only after canonical chain events are verified."
                        ko="정규 체인 이벤트를 확인한 뒤에만 영수증과 웹훅을 성공 처리합니다."
                      />
                    </p>
                  </article>
                </div>
              </section>

              <section className="boundary-section" aria-labelledby="boundary-title">
                <p className="eyebrow">
                  <Bilingual en="SECURITY BOUNDARIES" ko="보안 경계" />
                </p>
                <h3 id="boundary-title">
                  <Bilingual en="Clear about the limits." ko="구현 범위를 명확하게 밝힙니다." />
                </h3>
                <ul className="boundary-list">
                  <li>
                    <strong>
                      <Bilingual en="Non-custodial" ko="비수탁" />
                    </strong>
                    <span>
                      <Bilingual
                        en="No GiwaPay balance exists between transactions."
                        ko="트랜잭션 사이에 GiwaPay 잔액이 존재하지 않습니다."
                      />
                    </span>
                  </li>
                  <li>
                    <strong>
                      <Bilingual en="Registered recipients" ko="등록된 수령인" />
                    </strong>
                    <span>
                      <Bilingual
                        en="An invoice signer cannot replace merchant-admin registered splits."
                        ko="청구서 서명자는 판매자 관리자가 등록한 분배 대상을 바꿀 수 없습니다."
                      />
                    </span>
                  </li>
                  <li>
                    <strong>
                      <Bilingual en="Mocks stay labelled" ko="Mock은 명확히 표시" />
                    </strong>
                    <span>
                      <Bilingual
                        en="No production DEX, fiat rail, mainnet, or gasless integration is claimed."
                        ko="프로덕션 DEX, 법정화폐 결제망, 메인넷 또는 가스리스 연동을 주장하지 않습니다."
                      />
                    </span>
                  </li>
                  <li>
                    <strong>
                      <Bilingual en="Not audited" ko="감사 미완료" />
                    </strong>
                    <span>
                      <Bilingual
                        en="This testnet MVP is not production-ready or officially partnered with GIWA."
                        ko="이 테스트넷 MVP는 프로덕션 준비 또는 GIWA 공식 파트너십을 주장하지 않습니다."
                      />
                    </span>
                  </li>
                </ul>
              </section>

              <nav className="detail-links" aria-label="Technical references / 기술 문서">
                <a
                  href={`${github}/blob/main/docs/architecture.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Bilingual en="Architecture" ko="아키텍처" />
                </a>
                <a
                  href={`${github}/blob/main/docs/threat-model.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Bilingual en="Threat model" ko="위협 모델" />
                </a>
                <a href={`${github}/blob/main/docs/api.md`} target="_blank" rel="noreferrer">
                  <Bilingual en="API docs" ko="API 문서" />
                </a>
              </nav>
            </div>
          </details>
        </section>
      </main>

      <footer>
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>GiwaPay</span>
        </a>
        <p>
          <Bilingual
            en="Pay with anything. Settle exactly."
            ko="결제는 자유롭게. 정산은 정확하게."
          />
        </p>
        <p>
          <Bilingual en="Open-source testnet MVP · 2026" ko="오픈소스 테스트넷 MVP · 2026" />
        </p>
      </footer>
    </div>
  );
}

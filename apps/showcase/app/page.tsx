import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { LanguageToggle } from './language-toggle';

export const metadata: Metadata = {
  title: 'GiwaPay — Public Testnet MVP Showcase',
  description: 'GiwaPay의 제품 흐름, 보안 경계, 오픈소스 구현과 검증 범위를 확인하세요.',
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

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4 10 4 4 8-8" />
    </svg>
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
        <nav aria-label="Primary navigation / 주요 탐색">
          <a href="#flow">
            <Bilingual en="Flow" ko="결제 흐름" />
          </a>
          <a href="#proof">
            <Bilingual en="Proof" ko="검증 근거" />
          </a>
          <a href="#boundaries">
            <Bilingual en="Boundaries" ko="보안 경계" />
          </a>
        </nav>
        <div className="topbar-actions">
          <LanguageToggle />
          <a className="source-link" href={github} target="_blank" rel="noreferrer">
            <Bilingual en="View source" ko="소스 보기" />
            <ArrowIcon />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="status-pill">
              <span aria-hidden="true" />
              <Bilingual en="Public showcase · Testnet MVP" ko="공개 쇼케이스 · 테스트넷 MVP" />
            </div>
            <h1>
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
                    가진 자산으로 결제하고.
                    <br />
                    <em>정확히</em> 정산하세요.
                  </>
                }
              />
            </h1>
            <p className="hero-korean">
              <Bilingual
                en="Customers pay with assets they hold, while merchants receive the exact amount in the settlement asset they chose."
                ko="사용자는 가진 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액으로 정산받는 GIWA 기반 비수탁 결제 레이어."
              />
            </p>
            <p className="hero-detail">
              <Bilingual
                en="GiwaPay binds the settlement token, exact amount, recipient split, fee, and expiry into a merchant-signed intent—then settles atomically on-chain."
                ko="GiwaPay는 정산 토큰, 정확한 금액, 분배 대상, 수수료, 만료 조건을 판매자 서명 인텐트에 묶고 온체인에서 원자적으로 정산합니다."
              />
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={github} target="_blank" rel="noreferrer">
                <Bilingual en="Explore the repository" ko="저장소 살펴보기" />
                <ArrowIcon />
              </a>
              <a
                className="button button-secondary"
                href={`${github}/blob/main/docs/architecture.md`}
              >
                <Bilingual en="Read architecture" ko="아키텍처 읽기" />
              </a>
            </div>
            <p className="release-note">
              <Bilingual
                en={
                  <>
                    <strong>Scope notice:</strong> public product showcase only. Live GIWA Sepolia
                    contracts and payment execution are not deployed yet.
                  </>
                }
                ko={
                  <>
                    <strong>범위 안내:</strong> 공개 제품 쇼케이스입니다. GIWA Sepolia 컨트랙트와
                    실제 결제 실행 환경은 아직 배포되지 않았습니다.
                  </>
                }
              />
            </p>
          </div>

          <div
            className="protocol-card"
            aria-label="GiwaPay settlement invariant / GiwaPay 정산 불변식"
          >
            <div className="protocol-card-head">
              <span>
                <Bilingual en="PAYMENT ROUTE" ko="결제 경로" />
              </span>
              <span className="network-label">GIWA Sepolia · 91342</span>
            </div>
            <div className="route-row">
              <div className="token-node token-node-input">
                <span>
                  <Bilingual en="Customer input" ko="고객 결제 자산" />
                </span>
                <strong>
                  <Bilingual en="Supported ERC-20" ko="지원 ERC-20" />
                </strong>
                <small>
                  <Bilingual en="≤ signed max input" ko="≤ 서명된 최대 입력량" />
                </small>
              </div>
              <div className="route-arrow" aria-hidden="true">
                <span />
                <b>
                  <Bilingual en="exact output" ko="정확 출력" />
                </b>
              </div>
              <div className="token-node token-node-output">
                <span>
                  <Bilingual en="Merchant settlement" ko="판매자 정산" />
                </span>
                <strong>
                  <Bilingual en="Chosen ERC-20" ko="선택한 ERC-20" />
                </strong>
                <small>
                  <Bilingual en="= signed exact amount" ko="= 서명된 정확한 금액" />
                </small>
              </div>
            </div>
            <div className="invariant">
              <span>
                <Bilingual en="ATOMIC INVARIANT" ko="원자적 불변식" />
              </span>
              <code>settled == exactAmount</code>
            </div>
            <div className="distribution">
              <div>
                <span className="distribution-dot distribution-dot-green" />
                <Bilingual en="Registered split" ko="등록된 분배" />
              </div>
              <div>
                <span className="distribution-dot distribution-dot-blue" />
                <Bilingual en="Platform fee" ko="플랫폼 수수료" />
              </div>
              <div>
                <span className="distribution-dot distribution-dot-white" />
                <Bilingual en="Unused input refund" ko="미사용 입력 환불" />
              </div>
            </div>
            <p>
              <Bilingual
                en="All complete in one transaction—or all revert."
                ko="모든 과정이 한 트랜잭션에서 완료되거나, 전부 되돌아갑니다."
              />
            </p>
          </div>
        </section>

        <section className="section" id="flow">
          <div className="section-heading">
            <p className="eyebrow">
              <Bilingual en="THE PAYMENT PATH" ko="결제 흐름" />
            </p>
            <h2>
              <Bilingual
                en="Flexible at checkout. Precise at settlement."
                ko="결제는 유연하게. 정산은 정확하게."
              />
            </h2>
            <p>
              <Bilingual
                en="The backend prepares intent data, the customer authorizes the transaction, and canonical chain evidence—not a client-side state—decides success."
                ko="백엔드가 인텐트 데이터를 준비하고 고객이 트랜잭션을 승인하면, 클라이언트 화면이 아니라 검증된 온체인 증거가 결제 성공을 결정합니다."
              />
            </p>
          </div>
          <ol className="flow-grid">
            <li>
              <span className="flow-number">01</span>
              <div className="flow-icon">I</div>
              <h3>
                <Bilingual en="Signed intent" ko="서명된 인텐트" />
              </h3>
              <p>
                <Bilingual
                  en="A delegated invoice signer commits to the exact settlement terms and a registry-owned split."
                  ko="위임된 청구서 서명자가 정확한 정산 조건과 레지스트리에 등록된 분배 구성에 커밋합니다."
                />
              </p>
              <code>EIP-712 · replay protected</code>
            </li>
            <li>
              <span className="flow-number">02</span>
              <div className="flow-icon">A</div>
              <h3>
                <Bilingual en="Atomic routing" ko="원자적 라우팅" />
              </h3>
              <p>
                <Bilingual
                  en="Pay directly or through a code-hash checked exact-output adapter with input caps."
                  ko="직접 결제하거나 코드 해시와 입력 한도가 검증된 exact-output 어댑터를 이용합니다."
                />
              </p>
              <code>approve → swap → distribute</code>
            </li>
            <li>
              <span className="flow-number">03</span>
              <div className="flow-icon">V</div>
              <h3>
                <Bilingual en="Canonical verification" ko="정식 온체인 검증" />
              </h3>
              <p>
                <Bilingual
                  en="An independent indexer verifies confirmations and settlement events before success."
                  ko="독립 인덱서가 컨펌 수와 정산 이벤트를 확인한 뒤에만 성공으로 처리합니다."
                />
              </p>
              <code>event → receipt → webhook</code>
            </li>
          </ol>
        </section>

        <section className="proof-section" id="proof">
          <div className="proof-copy">
            <p className="eyebrow">
              <Bilingual en="IMPLEMENTED, NOT SIMULATED" ko="시뮬레이션이 아닌 실제 구현" />
            </p>
            <h2>
              <Bilingual en="A reviewable proof product." ko="직접 검토할 수 있는 증명 제품." />
            </h2>
            <p>
              <Bilingual
                en="The public repository contains the contracts, API, indexer, webhook worker, dashboard, SDK, deployment scripts, threat model, and fail-closed local acceptance flow."
                ko="공개 저장소에는 컨트랙트, API, 인덱서, 웹훅 워커, 대시보드, SDK, 배포 스크립트, 위협 모델과 fail-closed 로컬 검증 흐름이 포함되어 있습니다."
              />
            </p>
            <a href={`${github}/blob/main/docs/testing.md`} target="_blank" rel="noreferrer">
              <Bilingual en="Open the verification guide" ko="검증 가이드 열기" />
              <ArrowIcon />
            </a>
          </div>
          <div className="proof-list">
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>
                  <Bilingual en="Contract assurance" ko="컨트랙트 검증" />
                </strong>
                <p>
                  <Bilingual
                    en="Unit, fuzz, invariant, malicious-adapter, and accounting coverage in Foundry."
                    ko="Foundry에서 유닛, 퍼즈, 불변식, 악성 어댑터와 회계 정확성을 검증합니다."
                  />
                </p>
              </div>
            </article>
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>
                  <Bilingual en="End-to-end local settlement" ko="로컬 전체 정산 흐름" />
                </strong>
                <p>
                  <Bilingual
                    en="Anvil + PostgreSQL exercise payment, verified indexing, signed webhook, and merchant-funded refund."
                    ko="Anvil과 PostgreSQL로 결제, 검증된 인덱싱, 서명 웹훅, 판매자 부담 환불까지 실행합니다."
                  />
                </p>
              </div>
            </article>
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>
                  <Bilingual en="Operational packaging" ko="운영 패키징" />
                </strong>
                <p>
                  <Bilingual
                    en="Separate API, indexer, and webhook processes with Docker and CI definitions."
                    ko="API, 인덱서, 웹훅을 독립 프로세스로 실행하며 Docker와 CI 구성을 제공합니다."
                  />
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="section boundaries" id="boundaries">
          <div className="section-heading">
            <p className="eyebrow">
              <Bilingual en="SECURITY BOUNDARIES" ko="보안 경계" />
            </p>
            <h2>
              <Bilingual
                en="Clear about what exists—and what does not."
                ko="구현된 것과 구현되지 않은 것을 명확하게."
              />
            </h2>
          </div>
          <div className="boundary-grid">
            <article>
              <span>01</span>
              <h3>
                <Bilingual en="Never custodial" ko="자금을 보관하지 않음" />
              </h3>
              <p>
                <Bilingual
                  en="No GiwaPay balance exists between transactions. Funds either settle atomically or revert."
                  ko="트랜잭션 사이에 GiwaPay 잔액은 존재하지 않습니다. 자금은 원자적으로 정산되거나 전부 되돌아갑니다."
                />
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>
                <Bilingual en="No arbitrary recipients" ko="임의 수령인 차단" />
              </h3>
              <p>
                <Bilingual
                  en="A compromised invoice signer cannot replace merchant-admin registered split recipients."
                  ko="청구서 서명 키가 침해되어도 판매자 관리자가 등록한 정산 수령인을 바꿀 수 없습니다."
                />
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>
                <Bilingual en="No fake integrations" ko="가짜 연동 없음" />
              </h3>
              <p>
                <Bilingual
                  en="Mocks are labelled and isolated. Mainnet, fiat rails, gasless paymasters, and production DEXes are absent."
                  ko="Mock은 명확히 표시하고 격리합니다. 메인넷, 법정화폐 결제망, 가스리스 Paymaster, 프로덕션 DEX는 포함하지 않습니다."
                />
              </p>
            </article>
            <article>
              <span>04</span>
              <h3>
                <Bilingual en="Not audited" ko="감사 미완료" />
              </h3>
              <p>
                <Bilingual
                  en="This is an unaudited testnet MVP, not production-ready, regulated, or officially partnered with GIWA."
                  ko="아직 감사를 받지 않은 테스트넷 MVP이며, 프로덕션 준비·규제 승인·GIWA 공식 파트너십을 주장하지 않습니다."
                />
              </p>
            </article>
          </div>
        </section>

        <section className="closing">
          <div>
            <p className="eyebrow">
              <Bilingual en="OPEN FOR REVIEW" ko="누구나 검토 가능" />
            </p>
            <h2>
              <Bilingual
                en="Inspect every settlement assumption."
                ko="모든 정산 가정을 직접 확인하세요."
              />
            </h2>
          </div>
          <div className="closing-links">
            <a href={`${github}#readme`} target="_blank" rel="noreferrer">
              README <ArrowIcon />
            </a>
            <a href={`${github}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer">
              <Bilingual en="Threat model" ko="위협 모델" /> <ArrowIcon />
            </a>
            <a href={`${github}/blob/main/docs/api.md`} target="_blank" rel="noreferrer">
              <Bilingual en="API docs" ko="API 문서" /> <ArrowIcon />
            </a>
          </div>
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
            ko="가진 자산으로 결제하고, 정확히 정산하세요."
          />
        </p>
        <p>
          <Bilingual en="Open-source testnet MVP · 2026" ko="오픈소스 테스트넷 MVP · 2026" />
        </p>
      </footer>
    </div>
  );
}

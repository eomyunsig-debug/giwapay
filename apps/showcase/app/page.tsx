import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GiwaPay — Public Testnet MVP Showcase',
  description: 'GiwaPay의 제품 흐름, 보안 경계, 오픈소스 구현과 검증 범위를 확인하세요.',
};

const github = 'https://github.com/eomyunsig-debug/giwapay';

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
        <a className="brand" href="#top" aria-label="GiwaPay home">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span>GiwaPay</span>
        </a>
        <nav aria-label="주요 탐색">
          <a href="#flow">Flow</a>
          <a href="#proof">Proof</a>
          <a href="#boundaries">Boundaries</a>
        </nav>
        <a className="source-link" href={github} target="_blank" rel="noreferrer">
          View source
          <ArrowIcon />
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="status-pill">
              <span aria-hidden="true" />
              Public showcase · Testnet MVP
            </div>
            <h1>
              Pay with anything.
              <br />
              Settle <em>exactly.</em>
            </h1>
            <p className="hero-korean">
              사용자는 가진 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액으로 정산받는 GIWA
              기반 비수탁 결제 레이어.
            </p>
            <p className="hero-detail">
              GiwaPay binds the settlement token, exact amount, recipient split, fee, and expiry
              into a merchant-signed intent—then settles atomically on-chain.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={github} target="_blank" rel="noreferrer">
                Explore the repository
                <ArrowIcon />
              </a>
              <a
                className="button button-secondary"
                href={`${github}/blob/main/docs/architecture.md`}
              >
                Read architecture
              </a>
            </div>
            <p className="release-note">
              <strong>Scope notice:</strong> public product showcase only. Live GIWA Sepolia
              contracts and payment execution are not deployed yet.
            </p>
          </div>

          <div className="protocol-card" aria-label="GiwaPay settlement invariant">
            <div className="protocol-card-head">
              <span>PAYMENT ROUTE</span>
              <span className="network-label">GIWA Sepolia · 91342</span>
            </div>
            <div className="route-row">
              <div className="token-node token-node-input">
                <span>Customer input</span>
                <strong>Supported ERC-20</strong>
                <small>≤ signed max input</small>
              </div>
              <div className="route-arrow" aria-hidden="true">
                <span />
                <b>exact output</b>
              </div>
              <div className="token-node token-node-output">
                <span>Merchant settlement</span>
                <strong>Chosen ERC-20</strong>
                <small>= signed exact amount</small>
              </div>
            </div>
            <div className="invariant">
              <span>ATOMIC INVARIANT</span>
              <code>settled == exactAmount</code>
            </div>
            <div className="distribution">
              <div>
                <span className="distribution-dot distribution-dot-green" />
                Registered split
              </div>
              <div>
                <span className="distribution-dot distribution-dot-blue" />
                Platform fee
              </div>
              <div>
                <span className="distribution-dot distribution-dot-white" />
                Unused input refund
              </div>
            </div>
            <p>All complete in one transaction—or all revert.</p>
          </div>
        </section>

        <section className="section" id="flow">
          <div className="section-heading">
            <p className="eyebrow">THE PAYMENT PATH</p>
            <h2>Flexible at checkout. Precise at settlement.</h2>
            <p>
              The backend prepares intent data, the customer authorizes the transaction, and
              canonical chain evidence—not a client-side state—decides success.
            </p>
          </div>
          <ol className="flow-grid">
            <li>
              <span className="flow-number">01</span>
              <div className="flow-icon">I</div>
              <h3>Signed intent</h3>
              <p>
                A delegated invoice signer commits to the exact settlement terms and a
                registry-owned split.
              </p>
              <code>EIP-712 · replay protected</code>
            </li>
            <li>
              <span className="flow-number">02</span>
              <div className="flow-icon">A</div>
              <h3>Atomic routing</h3>
              <p>
                Pay directly or through a code-hash checked exact-output adapter with input caps.
              </p>
              <code>approve → swap → distribute</code>
            </li>
            <li>
              <span className="flow-number">03</span>
              <div className="flow-icon">V</div>
              <h3>Canonical verification</h3>
              <p>
                An independent indexer verifies confirmations and settlement events before success.
              </p>
              <code>event → receipt → webhook</code>
            </li>
          </ol>
        </section>

        <section className="proof-section" id="proof">
          <div className="proof-copy">
            <p className="eyebrow">IMPLEMENTED, NOT SIMULATED</p>
            <h2>A reviewable proof product.</h2>
            <p>
              The public repository contains the contracts, API, indexer, webhook worker, dashboard,
              SDK, deployment scripts, threat model, and fail-closed local acceptance flow.
            </p>
            <a href={`${github}/blob/main/docs/testing.md`} target="_blank" rel="noreferrer">
              Open the verification guide
              <ArrowIcon />
            </a>
          </div>
          <div className="proof-list">
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>Contract assurance</strong>
                <p>Unit, fuzz, invariant, malicious-adapter, and accounting coverage in Foundry.</p>
              </div>
            </article>
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>End-to-end local settlement</strong>
                <p>
                  Anvil + PostgreSQL exercise payment, verified indexing, signed webhook, and
                  merchant-funded refund.
                </p>
              </div>
            </article>
            <article>
              <span className="proof-check">
                <CheckIcon />
              </span>
              <div>
                <strong>Operational packaging</strong>
                <p>Separate API, indexer, and webhook processes with Docker and CI definitions.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="section boundaries" id="boundaries">
          <div className="section-heading">
            <p className="eyebrow">SECURITY BOUNDARIES</p>
            <h2>Clear about what exists—and what does not.</h2>
          </div>
          <div className="boundary-grid">
            <article>
              <span>01</span>
              <h3>Never custodial</h3>
              <p>
                No GiwaPay balance exists between transactions. Funds either settle atomically or
                revert.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>No arbitrary recipients</h3>
              <p>
                A compromised invoice signer cannot replace merchant-admin registered split
                recipients.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>No fake integrations</h3>
              <p>
                Mocks are labelled and isolated. Mainnet, fiat rails, gasless paymasters, and
                production DEXes are absent.
              </p>
            </article>
            <article>
              <span>04</span>
              <h3>Not audited</h3>
              <p>
                This is an unaudited testnet MVP, not production-ready, regulated, or officially
                partnered with GIWA.
              </p>
            </article>
          </div>
        </section>

        <section className="closing">
          <div>
            <p className="eyebrow">OPEN FOR REVIEW</p>
            <h2>Inspect every settlement assumption.</h2>
          </div>
          <div className="closing-links">
            <a href={`${github}#readme`} target="_blank" rel="noreferrer">
              README <ArrowIcon />
            </a>
            <a href={`${github}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer">
              Threat model <ArrowIcon />
            </a>
            <a href={`${github}/blob/main/docs/api.md`} target="_blank" rel="noreferrer">
              API docs <ArrowIcon />
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
        <p>Pay with anything. Settle exactly.</p>
        <p>Open-source testnet MVP · 2026</p>
      </footer>
    </div>
  );
}

# GASOK two-minute demo

Status: **recording script — add a URL only after a real recording is uploaded**

The goal is to show a real, reproducible local payment lifecycle without
pretending that the public showcase executes payments or that GIWA Sepolia
contracts are deployed.

## Recording banner

Keep this visible in the opening frame:

> Local Anvil · chain ID 91342 · valueless Mock tokens · no public GIWA
> broadcast

Do not show a seed phrase, private key, API key, cookie, webhook secret,
database URL, KMS identifier, or unmasked environment output.

## Before recording

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm demo:up
```

Prepare one public test wallet with:

```sh
./scripts/fund-demo-wallet.sh 0xYourPublicWalletAddress
```

Use the direct settlement-token path for the main story. If a routed
MockUSDC-to-MockKRW payment is shown, say on-screen that the fixed-rate adapter
is a test-only simulation and no production DEX is integrated.

## Storyboard

### 0:00–0:12 — Problem and GIWA fit

Screen: title card and public showcase.

Narration:

> 고객이 가진 자산과 판매자가 받고 싶은 자산은 다를 수 있습니다. GiwaPay는
> 수탁 잔액 없이 정확 정산과 검증된 영수증을 GIWA 결제 링크로 만듭니다.

### 0:12–0:30 — Merchant creates a request

Screen: merchant dashboard, settlement token, exact amount, description, and
expiry.

Narration:

> 판매자는 정산 토큰, 정확한 금액, 등록 수령인과 만료를 지정합니다.
> PaymentIntent 서명은 이 조건과 실제 분배 snapshot을 고정합니다.

Do not linger on setup forms. Keep the amount and testnet label readable.

### 0:30–0:55 — Customer reviews the checkout

Screen: checkout link on a narrow/mobile viewport.

Show:

- merchant;
- exact amount the merchant receives;
- selected input token;
- estimated and maximum input;
- platform fee;
- expiry; and
- testnet/mock label.

Narration:

> 고객은 예상액이 아니라 최대 입력액까지 확인합니다. 직접 결제는 DEX 없이
> 동작하고, 다른 자산 라우팅은 검토된 어댑터와 유동성이 있을 때만 열립니다.

### 0:55–1:18 — Explicit wallet actions

Screen: token approval only if allowance is insufficient, then payment.

Narration:

> 필요한 경우에만 토큰 승인을 받고, 새 prepare 응답이 화면의 견적과
> 일치할 때 결제를 요청합니다. 조건이 바뀌면 자동 진행하지 않고 다시
> 확인받습니다.

### 1:18–1:40 — Submission is not success

Screen: `submitted` or `verifying` state, followed by the verified receipt.

Narration:

> 지갑이 해시를 반환해도 성공으로 표시하지 않습니다. 독립 인덱서가
> canonical PaymentSucceeded와 실제 분할 정산을 확인한 뒤에만 검증된
> 영수증을 만듭니다.

Pause briefly so both states are visible.

### 1:40–1:54 — Evidence

Screen: GitHub `main`, post-merge CI, and the four green jobs.

Narration:

> 같은 코드에서 workspace 검증, Slither, PostgreSQL과 Anvil 결제 통합,
> Chromium 브라우저 검증이 모두 통과합니다.

Do not describe CI as an external audit.

### 1:54–2:00 — Close

Screen: product statement and wallet-mode diagram.

Narration:

> Phase 3에서는 GIWA Wallet host 경계, 두 곳의 테스트넷 merchant pilot,
> 그리고 외부 계약 리뷰를 순서대로 검증하겠습니다.

## Acceptance take

Use the take only if it shows all of the following:

- [ ] opening testnet/local disclaimer;
- [ ] merchant exact settlement amount;
- [ ] customer maximum input and fee;
- [ ] explicit approval/payment prompts;
- [ ] submitted or verifying state before success;
- [ ] verified receipt after the indexed canonical event;
- [ ] mock adapter disclosure if the routed path appears;
- [ ] no secrets or private customer data;
- [ ] repository and successful post-merge CI;
- [ ] duration at or below 2:00.

## Evidence record

Complete only after recording:

- Video URL: `[not recorded]`
- Recorded at: `[not recorded]`
- Source commit: `[not recorded]`
- Demo path: `direct token` / `labelled mock adapter`
- Browser and viewport: `[not recorded]`
- Transaction and receipt identifiers: keep private unless they are disposable
  local fixtures.

# GiwaPay GASOK application brief

Status: **submission-content draft. The public form definition was verified on
2026-07-30, but the live form must be checked once more before submission.
Applicant details, a verified GIWA Sepolia contract, an executable-flow demo,
consent decisions, final source/CI links, and a submission receipt are still
pending.**

The official GASOK page lists **2026-07-31** as the additional-application
deadline. An
[official Upbit program notice](https://upbit.com/service_center/notice?id=1629960096)
lists **2026-07-31 23:59:59**, but the notice does not state a time zone and the
form time zone was not independently verified in this review. Treat July 31 as
a hard deadline and submit well before the listed time. Phase 1 and Phase 2 are
combined, so the current application evaluates both the idea and implemented
MVP. The notice says selected teams will be contacted at their application
email by **2026-08-14**.

Sources:

- Official program page: <https://giwa.io/gasok>
- Official Upbit program notice, including the `23:59:59` cutoff:
  <https://upbit.com/service_center/notice?id=1629960096>
- Official public form definition:
  <https://ds.fdback.me/api/v1/dataspace-answer/survey?serial=bLHPv694o6Au3&answerToken=>

## Links to submit

- Product: **GiwaPay**
- Official application form: <https://ds.fdback.me/r/bLHPv694o6Au3>
- Public showcase, supplemental and non-transactional:
  <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Source: <https://github.com/eomyunsig-debug/giwapay>
- Public pitch deck, **pre-deployment draft that must be regenerated before
  submission**:
  <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/pitch/GiwaPay-GASOK-Pitch-Deck.pdf>
- Public technical one-pager:
  <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/gasok-one-pager.md>
- Judge evidence path:
  <https://github.com/eomyunsig-debug/giwapay/blob/main/docs/gasok-judge-evidence.md>
- Current submission-package CI baseline on `main` (`ba58d86`):
  <https://github.com/eomyunsig-debug/giwapay/actions/runs/30525618053>
- Current `main` CI history:
  <https://github.com/eomyunsig-debug/giwapay/actions/workflows/ci.yml?query=branch%3Amain>
- Wallet in-app proposal: [giwa-wallet-embedded-mode.md](giwa-wallet-embedded-mode.md)
- Two-minute demo plan: [submission-demo.md](submission-demo.md)
- Market model and pilot plan: [market-opportunity.md](market-opportunity.md)
- Executable-flow demo: **`[required before submission]`**
- GIWA Sepolia verified contract: **`[required before submission]`**
- Public team introduction: **`[required before submission]`**
- Submission receipt: **`[record after submission]`**

The pitch-deck and one-pager links above are pinned to the immutable artifact
commit. Record the final reviewed deployment source commit and its successful
CI run before submission.

## Confirmed Korean form map — re-check before submission

The official public form definition was inspected on **2026-07-30**. The form
may still change before the deadline, so follow the labels, limits, and required
state shown in the live Korean form at submission time.

Before the twelve questions, the applicant must accept the required personal
information and code-review policy gates. The code-review policy says a GitHub
link is not required at application time, but teams advancing to the Production
Phase may be asked to provide codebase access; demo/code mismatch or refusal to
share the repository can disqualify a team. The applicant must personally
review the exact live consent language and decide whether to accept it.

|   # | Confirmed Korean field          | Requirement and draft submission value                                                                                                                                                                                                           |
| --: | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Team name                       | Required, 1–50 characters: `GiwaPay`                                                                                                                                                                                                             |
|   2 | Team email                      | Required: `[applicant-provided reachable email]`                                                                                                                                                                                                 |
|   3 | Team introduction               | Required: public file link containing member name, role, nationality, career, and core strength                                                                                                                                                  |
|   4 | Motivation                      | Required, 1–500 characters: use **Motivation** below                                                                                                                                                                                             |
|   5 | Track                           | Required, exactly one: **Mass Adoption**                                                                                                                                                                                                         |
|   6 | One-line project summary        | Required, 1–50 characters: use **One line** below                                                                                                                                                                                                |
|   7 | Pitch deck                      | Required, public link, 1–500 characters: **regenerate the current draft, then replace this pinned draft URL** <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/pitch/GiwaPay-GASOK-Pitch-Deck.pdf> |
|   8 | Project link                    | Required, public working-MVP or core-demo-video link, 1–500 characters: **`[PENDING — truthful executable-flow demo URL]`**                                                                                                                      |
|   9 | Verified GIWA testnet contract  | Required, 1–500 characters: **`[PENDING — verified GIWA Explorer or verified-contract repository URL]`**                                                                                                                                         |
|  10 | Technical document or one-pager | Required, public link, 1–500 characters: <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/gasok-one-pager.md>                                                                                      |
|  11 | Additional GASOK support        | Optional in the Korean path, 1–500 characters when answered: use **Additional support** below                                                                                                                                                    |
|  12 | Message to the GIWA team        | Optional in the Korean path, 1–500 characters when answered: use **Message to GIWA** below                                                                                                                                                       |

Use the Korean path: questions 11 and 12 are optional there but appear
non-skippable in the English definition. Questions 3, 7, 8, and 10 require
links that reviewers can open without requesting access. Keep the MVP, video,
contract, source commit, and written claims aligned so reviewers are not shown
conflicting evidence.

## Selected track

Use **Mass Adoption** as the primary editorial choice for this application.

The official landing page says projects may participate in multiple tracks, but
the current form permits exactly one track per application. Mass Adoption
matches the core user story: a familiar payment link hides chain mechanics
while preserving self-custody, explicit limits, and verifiable settlement.
GIWA-native infrastructure is the reason the product is credible, not a reason
to file a duplicate application. Do not submit the same project twice without
written program guidance.

## Copy-ready answers

### One line

> 고객은 지원 자산으로, 판매자는 정한 자산·정확한 금액으로 받는 GIWA 결제

This is 43 Unicode characters and matches the configured/allowlisted asset
boundary. Confirm the live form's current limit before pasting it.

### One line in English

> GiwaPay is a non-custodial payment layer where customers pay with a supported
> asset and merchants receive the exact token and amount they chose.

### Motivation

> GASOK에서 GiwaPay의 핵심 가설을 실제 GIWA 결제로 검증하고 싶습니다.
> 판매자에게 필요한 것은 또 하나의 지갑 버튼이 아니라 서명된 결제 조건,
> 정확 정산, canonical 이벤트로 확인된 영수증입니다. 이미 컨트랙트, API,
> 인덱서, 체크아웃, 대시보드와 SDK를 한 저장소에 구현했습니다. Phase 3에서는
> GIWA Wallet 팀과 공식 host 경계를 정하고, 소규모 해외 판매자 2곳의
> 테스트넷 파일럿과 외부 계약 리뷰로 실사용 가능성을 증명하겠습니다.

### Short description

> GiwaPay는 판매자가 서명한 결제 요청, 원자적 직접 결제 또는 허용된
> exact-output 라우팅, 등록된 분할 정산, 독립 인덱서가 검증한 영수증을 하나의
> 결제 링크로 제공합니다. 프런트엔드 콜백이나 제출된 트랜잭션 해시만으로는
> 성공 처리하지 않고, canonical GIWA 체인 이벤트를 확인한 뒤에만 결제를
> 확정합니다. 현재 공개물은 GIWA Sepolia용 테스트넷 MVP이며 실자산·메인넷
> 배포를 주장하지 않습니다.

### Problem

> 온체인 결제를 받으려는 판매자는 고객이 가진 자산과 자신이 정산받고 싶은
> 자산이 다를 때 라우팅, 슬리피지 상한, 수령인 분배, 영수증 검증을 각각
> 구현해야 합니다. 지갑 제출이나 트랜잭션 해시만으로 성공 처리하는 구현은
> 재조직·실패·잘못된 이벤트를 구분하지 못합니다. 수탁형 중간 잔액을 두면
> 키 관리와 규제 부담도 커집니다.

### Solution

> 판매자는 토큰·정확한 정산액·등록 수령인·만료를 EIP-712 PaymentIntent로
> 고정합니다. 고객은 지원 자산을 선택하고 최대 입력액을 확인한 뒤 직접
> 라우터를 호출합니다. 결제, 선택적 교환, 수수료, 분할 정산과 미사용 입력
> 환불은 하나의 트랜잭션에서 모두 실행되거나 모두 되돌아갑니다. GiwaPay는
> 자금을 보관하지 않으며, 독립 인덱서가 canonical 이벤트와 실제 분배를
> 확인한 뒤에만 영수증과 웹훅을 성공 처리합니다.

### Why GIWA

> GIWA는 이 제품에 단순히 저렴한 EVM 체인이 아닙니다. 공식 문서는 OP
> Stack 기반 EVM 실행 환경과 함께 향후 셀프 커스터디 Wallet, Dojang
> attestations, Upbit Web3 Names, 스테이블코인 결제 생태계를 제시합니다.
> GiwaPay는 그 사이의 판매자 레이어—서명된 결제 요청, 정확 정산, 등록
> 수령인, 검증된 영수증—를 담당합니다. 현재 구현은 GIWA Sepolia에서
> fail-closed하고 표준 EIP-1193/EIP-6963만 사용합니다. GIWA Wallet,
> 메인넷, Upbit 거래소 또는 페이마스터 연동이 이미 제공된다고 주장하지
> 않습니다.

Official product context:
[GIWA introduction](https://docs.giwa.io/),
[GIWA ecosystem](https://giwa.io/home), and
[testnet terms](https://docs.giwa.io/giwa-chain/en/terms-and-policies/testnet-terms-of-use).

### What is original

> 차별점은 “토큰 결제 버튼”이 아니라 결제 진실의 경계입니다. 판매자 서명은
> 정산 토큰·금액뿐 아니라 `splitHash`로 실제 수령인과 비율까지 고정합니다.
> 라우터는 정확한 balance delta를 검증하고, 백엔드는 브라우저 콜백이 아닌
> confirmation-aware canonical 이벤트만 수용합니다. 그 결과 판매자는
> 수탁 잔액 없이도 결제 시점의 정산 증거를 영수증과 웹훅으로 재사용할 수
> 있습니다.

### Implementation and technical completeness

> Solidity contracts, Fastify API, PostgreSQL projections, TypeScript SDK,
> React checkout, merchant dashboard, indexer, webhook and retention workers,
> Docker, local Anvil flow와 CI가 하나의 monorepo에 구현되어 있습니다.
> EOA·ERC-1271 서명, merchant별 비추출 KMS key 경계, admin 2단계 회전,
> idempotency, rate limit, reorg rollback, 분할 정산 snapshot, 부분 환불과
> production fail-closed 설정을 포함합니다. 병합 후 `main`에서 workspace
> verification, Slither, PostgreSQL/Anvil 결제 통합, Chromium browser의
> 네 작업이 모두 통과했습니다. 외부 보안 감사를 받았다는 의미는 아닙니다.

### Market and first-customer hypothesis

> 첫 고객 가설은 해외 고객에게 상품이나 디지털 콘텐츠를 판매하면서 이미
> 스테이블 자산 정산을 선택할 수 있는 국내 소규모 판매자입니다. 2025년
> 한국의 온라인 해외 직접 판매액은 국가데이터처 기준 3조 234억원이었고,
> 면세점 제외 금액은 1조 9,621억원입니다. 이 거래액은 GiwaPay의 매출
> 예측이나 판매자 수가 아니라 관측 가능한 해외 직접 판매 규모의
> 기준선입니다. 현재 가맹점 확약은 공개적으로 검증되지 않았으므로, 다음
> 4주와 Phase 3의 목표는 15회 문제 인터뷰, 3곳의 서면 파일럿 의향,
> 2곳의 테스트넷 통합으로 수요와 온보딩 시간을 검증하는 것입니다.

Source and assumptions:
[market-opportunity.md](market-opportunity.md).

### Business model

> 판매자 정산액을 깎지 않고 고객의 결제 상한에 명시적으로 더해지는
> 플랫폼 수수료가 기본 모델입니다. 초기 테스트넷은 수익화가 아니라
> checkout 전환, 통합 시간, canonical receipt 성공률을 검증합니다.
> 운영 수수료, 가스, 라우팅 비용을 실제 파일럿 데이터로 확인하기 전에는
> 가격을 확정하지 않습니다.

### GIWA Wallet in-app fit

> 지갑 인앱 모드에서는 “지갑 연결”과 “체인 전환” 화면을 다시 보여주지 않고,
> host wallet이 제공한 승인된 EIP-1193 provider·account·GIWA chain context를
> 사용해 판매자, 정확 정산액, 고객 최대 입력액, 수수료, 만료를 한 화면에
> 표시합니다. host context가 불완전하거나 chain/account가 바뀌면 자동
> 실행하지 않고 fail closed합니다. 승인과 결제는 각각 명시적으로
> 확인받고, 제출 후에는 canonical 이벤트가 검증될 때까지 `verifying`
> 상태를 유지합니다. 이는 설계 제안이며 공식 GIWA Wallet SDK 연동 완료
> 주장이 아닙니다.

Full proposal:
[giwa-wallet-embedded-mode.md](giwa-wallet-embedded-mode.md).

### Additional support

> GIWA Wallet의 공식 host-provider·account·chain handoff 인터페이스 검토,
> Dojang/up.id를 판매자 신뢰 신호로 사용하는 범위에 대한 설계 자문,
> 테스트넷 RPC·컨트랙트 리뷰, 그리고 해외 판매자 파일럿 연결을 요청합니다.
> 공식 인터페이스가 확정되기 전에는 지갑·신원 연동을 구현 완료로 주장하지
> 않겠습니다.

### Message to GIWA

> GiwaPay는 제출된 트랜잭션 해시를 결제 성공으로 취급하지 않습니다. GIWA의
> canonical 이벤트가 실제 정산을 증명할 때만 판매자 영수증을 확정하는
> 제품을 만들고 있습니다. GASOK에서 이 안전한 경계를 실제 Wallet 내 결제와
> 초기 판매자 사용으로 이어가겠습니다.

### Eight-week Phase 3 plan

1. **Weeks 1–2 — demand proof:** 15 merchant interviews, three written pilot
   interests, direct-settlement token choice, pilot success criteria.
2. **Weeks 2–3 — wallet handoff:** agree on the GIWA Wallet host contract with
   the GIWA team; build the account/chain handoff and native confirmation view
   only against an official interface.
3. **Weeks 3–5 — testnet pilots:** integrate two merchants, use the direct-token
   path first, and measure setup time, checkout completion, and canonical
   receipt latency.
4. **Weeks 5–6 — production path:** choose a real settlement asset only after
   legal and liquidity review; keep multi-asset routing disabled until a
   production DEX and liquidity policy are approved.
5. **Weeks 7–8 — mainnet readiness:** external contract review, deployment
   rehearsal, database/KMS migration, multisig roles, incident and rollback
   runbooks. Broadcast only when an official GIWA mainnet path exists.

### Team

Do not invent team information. The Korean form requires a reachable email and
a public team-introduction link containing these fields:

- Applicant or team-member name: `[required]`
- Contact email: `[required]`
- Role and responsibilities: `[required]`
- Nationality: `[required]`
- Relevant career and project history: `[required]`
- Core strength: `[required]`
- Advisor or merchant references: `[none confirmed in repository]`
- Availability through the October 2026 Demo Day: `[applicant confirmation
needed before submission]`

## Selected-track framing

### Mass Adoption

> GiwaPay hides onchain complexity behind a familiar payment link while keeping
> custody, amount limits, and success evidence explicit. The adoption wedge is
> a direct settlement-token checkout; multi-asset routing is enabled only when
> production liquidity exists.

## Claim boundary

Use this table to keep the application and demo accurate.

| State           | Safe to say                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented     | GIWA Sepolia chain configuration; non-custodial router; direct token path; labelled mock exact-output adapter; EIP-712 and ERC-1271; canonical indexer; reorg rollback; verified receipts; post-merge CI |
| Proposed        | Official-wallet host handoff; in-app single-confirmation surface; Dojang/up.id address identity signal with separate merchant verification; production asset and DEX selection; testnet merchant pilots  |
| Required gate   | Public GIWA Sepolia deployment with at least one contract verified in GIWA Explorer; applicant-approved public team introduction; truthful executable-flow demo                                          |
| Not implemented | GIWA mainnet deployment; public GIWA Sepolia deployment manifest; official GIWA Wallet SDK; Upbit account or exchange integration; fiat custody/off-ramp; production KRW stablecoin; production DEX      |

## Final submission checklist

- [x] Capture the public Korean form map, required/optional status, character
      limits, and link requirements.
- [ ] Re-check that map and the exact consent wording in the live form.
- [x] Prepare **Mass Adoption** as the primary editorial choice; verify the live
      form's track mechanics before submission.
- [ ] Replace the email, identity, nationality, career, and availability
      placeholders in a public team-introduction file.
- [ ] Deploy to GIWA Sepolia and verify at least one submitted contract in GIWA
      Explorer. Do not paste an unverified address.
- [x] Prepare the public pitch deck and editable source.
- [x] Pin the pitch-deck and one-pager links to the immutable artifact commit.
- [ ] Record and upload a truthful executable-flow demo; add only the actual
      public URL.
- [ ] Use the merged `main` commit and the successful post-merge CI link.
- [ ] Keep Mock assets, local Anvil, and non-live public showcase labels visible.
- [ ] Re-check every URL in a signed-out browser.
- [ ] Personally review and accept or decline every consent item shown by the
      live form.
- [ ] Submit once, save the confirmation page or email, and record its timestamp
      before **2026-07-31**.

Suggested support question:

> 안녕하세요. GASOK 추가 지원 공지의 2026년 7월 31일 23:59:59 마감에
> 적용되는 시간대가 KST인지 확인 부탁드립니다. 답변을 기다리느라 제출을
> 늦추지는 않겠습니다.

# GiwaPay team introduction

Status: **public template only — it does not satisfy the GASOK team-introduction
requirement until every bracketed applicant field is replaced with approved,
verifiable information**

## Team

- Team name: **GiwaPay**
- Applicant: **`[full name]`**
- Role: **`[applicant-approved role]`**
- Nationality: **`[nationality]`**
- Contact: **`[public contact email]`**
- GASOK availability through October 2026: **`[availability]`**

Do not place a phone number, home address, identity document, wallet secret, or
other sensitive personal information in this public file.

## What we are building

GiwaPay is a non-custodial payment layer where customers pay with a supported
asset and merchants receive the exact token and amount they selected. A
merchant-signed `PaymentIntent` fixes the settlement token, exact amount,
registered recipients, fee boundary, and expiry. The backend treats a payment
as successful only after canonical GIWA events and the resulting balance
distribution are verified.

## Applicant background

Replace the prompts below with short, verifiable facts:

- Current role and organization: **`[one sentence]`**
- Relevant product or engineering experience: **`[two or three dated examples]`**
- Onchain, payments, security, or merchant experience: **`[specific evidence]`**
- Prior products, repositories, or public links: **`[URLs]`**
- Distinctive strength for GASOK: **`[why this applicant can execute Phase 3]`**

Avoid unsupported superlatives. Link to evidence where possible.

## Current execution evidence

- Public source: <https://github.com/eomyunsig-debug/giwapay>
- Public showcase: <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Implemented surface: Solidity contracts, API, indexer, webhooks, checkout,
  merchant dashboard, TypeScript SDKs, PostgreSQL projections, local Anvil
  integration, and CI.
- Safety boundary: the public showcase is non-transactional; production DEX,
  official GIWA Wallet SDK, mainnet, fiat custody, and Upbit exchange
  integrations are not claimed.

## Responsibilities

For a solo application:

| Area                                        | Owner              |
| ------------------------------------------- | ------------------ |
| Product scope and merchant discovery        | `[applicant name]` |
| Smart contracts and deployment              | `[applicant name]` |
| API, indexer, and merchant integration      | `[applicant name]` |
| Checkout UX and Wallet host proposal        | `[applicant name]` |
| Security review coordination and operations | `[applicant name]` |

If confirmed collaborators join, list their names, roles, nationalities,
relevant experience, and weekly availability. Do not present an advisor,
merchant, or collaborator as confirmed without their permission.

## Why this team

> GiwaPay already exists as an integrated, testable payment stack rather than a
> pitch-only concept. The team's next job is deliberately narrow: prove one
> direct-token GIWA Sepolia payment, verify the deployed contract publicly,
> validate the Wallet host boundary with GIWA, and complete two small-merchant
> testnet pilots before expanding routing or settlement claims.

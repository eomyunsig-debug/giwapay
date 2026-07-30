# GiwaPay GASOK final submission runbook

Official cutoff shown in the Upbit program notice: **2026-07-31 23:59:59**.
The form does not display a time zone, so use **2026-07-31 18:00 KST** as the
internal submission deadline.

## Go/no-go rule

Submit GiwaPay only when all four hard gates are green:

1. the public MVP or demo link opens without authentication;
2. at least one GiwaPay contract is deployed to GIWA Sepolia and verified in
   GIWA Explorer;
3. the pitch deck, team introduction, and technical one-pager are publicly
   readable; and
4. every form claim matches the public code, demo, and deployment evidence.

Do not replace the verified contract link with a dry-run, local Anvil address,
repository homepage, or unverified explorer page.

## July 30 — evidence lock

- [ ] Applicant approves creation or selection of a dedicated GIWA Sepolia
      deployer.
- [ ] Claim test ETH once through the
      [official faucet flow](https://docs.giwa.io/get-started/faucets) for that
      public address; do not automate or repeat claims.
- [ ] Broadcast the production-mode deployment with no mock adapter.
- [ ] Confirm chain ID `91342`, transaction receipts, runtime code, owners,
      fee recipient, and adapter manager.
- [ ] Confirm source verification in GIWA Explorer.
- [ ] Replace every deployment placeholder with the actual explorer link.
- [ ] Fill the team introduction with applicant-approved identity, nationality,
      experience, strengths, and availability.

## July 31 morning — reviewer path

- [ ] Record a two-minute local demo if the public showcase still cannot show
      the implemented payment lifecycle.
- [ ] Keep the local-Anvil, valueless-token, and non-live disclaimers visible.
- [ ] Show merchant request, maximum customer input, explicit wallet actions,
      `submitted`/`verifying`, then canonical verified receipt.
- [ ] Upload the video with public-link access and check it while signed out.
- [ ] Update the deck and application brief with the real deployment and video
      links.
- [ ] Merge the reviewed submission commit to public `main`.
- [ ] Re-run the full workspace verification against that exact commit.

## July 31 before 18:00 KST — submit

- [ ] Open every submitted URL in a signed-out browser.
- [ ] Copy the 12 answers from
      [`gasok-application.md`](gasok-application.md); do not improvise new
      traction or integrations in the form.
- [ ] Applicant personally reviews the privacy-processing and later
      codebase-access consents.
- [ ] Submit once.
- [ ] Save the confirmation page or email, submission timestamp, form answers,
      and source commit.

## Evidence record

- Source commit: **`[pending]`**
- Public deck: **`[pending]`**
- Public team introduction: **`[pending]`**
- Public one-pager: **`[pending]`**
- MVP or demo: <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Verified contract: **`[pending]`**
- Submission confirmation: **`[pending]`**

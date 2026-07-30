# GiwaPay GASOK final submission runbook

Official cutoff shown in the
[Upbit program notice](https://upbit.com/service_center/notice?id=6386):
**2026-07-31 23:59:59**.
The official notice does not state a time zone, and this review could not
independently verify the live form's time-zone display. Use
**2026-07-31 18:00 KST** as a conservative internal submission deadline.

## Go/no-go rule

Submit GiwaPay only when all four hard gates are green:

1. a truthful executable-flow MVP or recorded demo opens without
   authentication if the live form requests that evidence;
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
- [ ] Claim test ETH once through the [official faucet](https://faucet.giwa.io)
      for that public address; do not automate or repeat claims.
- [ ] Broadcast the production-mode deployment with no mock adapter.
- [ ] Confirm chain ID `91342`, transaction receipts, runtime code, owners,
      fee recipient, and adapter manager.
- [ ] Confirm source verification in GIWA Explorer.
- [ ] Replace every deployment placeholder with the actual explorer link.
- [ ] Fill the team introduction with applicant-approved identity, nationality,
      experience, strengths, and availability.

## July 31 morning — reviewer path

- [ ] Record a two-minute local executable-flow demo; the non-transactional
      public showcase is supplemental context, not a substitute.
- [ ] Keep the local-Anvil, valueless-token, and non-live disclaimers visible.
- [ ] Show merchant request, maximum customer input, explicit wallet actions,
      `submitted`/`verifying`, then canonical verified receipt.
- [ ] Upload the video with public-link access and check it while signed out.
- [ ] Update the deck and application brief with the real deployment and video
      links.
- [ ] Merge the reviewed submission commit to public `main`.
- [ ] Re-run the full workspace verification and obtain a public green CI run
      against that exact commit.

## July 31 before 18:00 KST — submit

- [ ] Open every submitted URL in a signed-out browser.
- [ ] Re-check the provisional form map in
      [`gasok-application.md`](gasok-application.md) against the live form, then
      copy only the answers that match; do not improvise new traction or
      integrations.
- [ ] Applicant personally reviews every consent item shown by the live form.
- [ ] Complete every field the live form marks as required, and confirm the
      demo, contract, source, and written implementation claims all match.
- [ ] Submit once.
- [ ] Save the confirmation page or email, submission timestamp, form answers,
      and source commit.

## Evidence record

- Source commit: **`[pending]`**
- Public deck:
  <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/pitch/GiwaPay-GASOK-Pitch-Deck.pdf>
- Public team introduction: **`[pending]`**
- Public one-pager:
  <https://github.com/eomyunsig-debug/giwapay/blob/e17ca73ec46033636c3b98b000075334116a8b7f/docs/gasok-one-pager.md>
- Executable-flow MVP or demo: **`[pending]`**
- Supplemental non-transactional showcase:
  <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Verified contract: **`[pending]`**
- Submission confirmation: **`[pending]`**

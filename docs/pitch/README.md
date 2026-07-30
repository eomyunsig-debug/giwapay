# GiwaPay GASOK pitch deck

`build-deck.mjs` is the editable source for both submission files:

- `GiwaPay-GASOK-Pitch-Deck.pptx`
- `GiwaPay-GASOK-Pitch-Deck.pdf`

The deck intentionally shows the verified GIWA testnet contract as
`PENDING`. Replace that state only after the production-mode deployment,
GIWA Explorer source verification, and public deployment manifest are real.
Do not place a private key, keystore, access token, or unreviewed address in
the deck.

## Rebuild

Initialize this directory with the bundled Presentation skill workspace helper
so `@oai/artifact-tool` is available, then run:

```sh
GIWAPAY_DECK_TMP_DIR=/tmp/giwapay-gasok-deck \
GIWAPAY_DECK_PYTHON=/path/to/python-with-pillow \
node docs/pitch/build-deck.mjs
```

The temporary directory receives slide PNGs, the montage, layout inspection
records, and the intermediate PPTX. Only the PPTX, PDF, source files, and
showcase screenshot belong in `docs/pitch/`.

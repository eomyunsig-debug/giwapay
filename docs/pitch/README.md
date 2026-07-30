# GiwaPay GASOK pitch deck

`build-deck.mjs` is the editable source for both submission files:

- `GiwaPay-GASOK-Pitch-Deck.pptx`
- `GiwaPay-GASOK-Pitch-Deck.pdf`

Final artifact SHA-256 values pinned by commit
`e17ca73ec46033636c3b98b000075334116a8b7f`:

- PPTX: `23cc06329208b4e8aacdbcef1e14386ea8ee9f182ea24ed1939d536599c3eb6e`
- PDF: `68118134f025fb15c4a38bafc17971d0a162259874116e5b268ffc149a50155b`

The deck intentionally shows the verified GIWA testnet contract as
`PENDING`. Replace that state only after the production-mode deployment,
GIWA Explorer source verification, and public deployment manifest are real.
Do not place a private key, keystore, access token, or unreviewed address in
the deck.

The PDF is assembled from the deck's reviewed slide renders so Korean
typography stays consistent across reviewer environments. Keep the PPTX as the
editable, source-linked version. The current eight-slide build has source notes
on every slide and passed the presentation overflow check; inspect the
all-slide montage after every rebuild.

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

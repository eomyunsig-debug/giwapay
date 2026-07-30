import fs from 'node:fs/promises';
import { error as writeError, log as writeLog } from 'node:console';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = process.env.GIWAPAY_DECK_TMP_DIR ?? path.join(os.tmpdir(), 'giwapay-gasok-deck');
const FINAL_PPTX =
  process.env.GIWAPAY_DECK_PPTX ?? path.join(SCRIPT_DIR, 'GiwaPay-GASOK-Pitch-Deck.pptx');
const FINAL_PDF =
  process.env.GIWAPAY_DECK_PDF ?? path.join(SCRIPT_DIR, 'GiwaPay-GASOK-Pitch-Deck.pdf');
const SCREENSHOT = path.join(SCRIPT_DIR, 'assets', 'giwapay-showcase-hero.png');
const PDF_ASSEMBLER = path.join(SCRIPT_DIR, 'build-pdf.py');

const W = 1280;
const H = 720;
const M = 48;

const C = {
  white: '#FFFFFF',
  ink: '#070A08',
  muted: '#5F6661',
  panel: '#F1F3F1',
  panelStrong: '#E4E8E5',
  rule: '#B8BEB9',
  accent: '#7CF6B1',
  accentDark: '#113D29',
  accentPale: '#E5FAEE',
  dangerPale: '#FFF2E5',
  danger: '#B45309',
};

const FONT_KO = 'Apple SD Gothic Neo';
const FONT_EN = 'Helvetica Neue';

function addRect(
  slide,
  name,
  left,
  top,
  width,
  height,
  fill,
  lineFill = 'none',
  lineWidth = 0,
  geometry = 'rect',
) {
  return slide.shapes.add({
    geometry,
    name,
    position: { left, top, width, height },
    fill,
    line: { style: 'solid', fill: lineFill, width: lineWidth },
  });
}

function addText(slide, name, text, left, top, width, height, options = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name,
    position: { left, top, width, height },
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontSize: options.fontSize ?? 22,
    bold: options.bold ?? false,
    color: options.color ?? C.ink,
    alignment: options.alignment ?? 'left',
    verticalAlignment: options.verticalAlignment ?? 'top',
    autoFit: options.autoFit ?? 'none',
    wrap: options.wrap ?? 'square',
    lineSpacing: options.lineSpacing ?? 0.95,
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
    typeface: options.typeface ?? FONT_KO,
  };
  return shape;
}

function addRule(slide, name, left, top, width, height = 1, fill = C.rule) {
  return addRect(slide, name, left, top, width, height, fill);
}

function addFooter(slide, page, label = 'GIWAPAY · GASOK') {
  addText(slide, `footer-label-${page}`, label, M, 668, 240, 18, {
    fontSize: 14,
    color: C.muted,
    typeface: FONT_EN,
    lineSpacing: 1,
  });
  addText(slide, `footer-page-${page}`, String(page).padStart(2, '0'), 1180, 668, 52, 18, {
    fontSize: 14,
    color: C.muted,
    alignment: 'right',
    typeface: FONT_EN,
    lineSpacing: 1,
  });
}

function addNotes(slide, talkTrack, sources) {
  const block = [
    talkTrack,
    '',
    '[Sources]',
    ...sources.map((source) => `- ${source}`),
    '[/Sources]',
  ].join('\n');
  slide.speakerNotes.textFrame.setText(block);
}

function addSlideTitle(slide, page, title, subtitle) {
  addText(slide, `slide-${page}-title`, title, M, 38, 1184, 78, {
    fontSize: 50,
    bold: true,
    lineSpacing: 0.9,
  });
  if (subtitle) {
    addText(slide, `slide-${page}-subtitle`, subtitle, M, 118, 1184, 38, {
      fontSize: 22,
      color: C.muted,
      lineSpacing: 1,
    });
  }
  addRule(slide, `slide-${page}-title-rule`, M, subtitle ? 164 : 132, 1184, 1);
}

function newSlide(presentation) {
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  return slide;
}

async function build() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  await fs.mkdir(path.join(TMP_DIR, 'artifact-render'), { recursive: true });

  const presentation = Presentation.create({
    slideSize: { width: W, height: H },
  });

  // 01 — Cover (Codex Grid slide 08 silhouette)
  {
    const slide = newSlide(presentation);
    addText(slide, 'cover-eyebrow', 'GASOK · MASS ADOPTION · 2026', M, 42, 520, 28, {
      fontSize: 18,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(slide, 'cover-wordmark', 'GiwaPay', M, 112, 520, 100, {
      fontSize: 76,
      bold: true,
      typeface: FONT_EN,
      lineSpacing: 0.9,
    });
    addText(
      slide,
      'cover-title',
      '고객은 지원 자산으로,\n판매자는 정확한 금액으로.',
      M,
      230,
      540,
      164,
      {
        fontSize: 48,
        bold: true,
        lineSpacing: 0.9,
      },
    );
    addText(
      slide,
      'cover-subtitle',
      '비수탁 결제 링크 · 원자적 정산 · canonical event 영수증',
      M,
      424,
      540,
      58,
      {
        fontSize: 22,
        color: C.muted,
        lineSpacing: 1,
      },
    );
    addRect(slide, 'cover-status-bg', M, 536, 366, 44, C.accentPale);
    addText(slide, 'cover-status', 'GIWA Sepolia · 테스트넷 MVP', M + 16, 548, 334, 22, {
      fontSize: 18,
      bold: true,
      color: C.accentDark,
      lineSpacing: 1,
    });
    addText(
      slide,
      'cover-boundary',
      '공개 쇼케이스는 비거래형입니다. live GIWA 계약은 제출 전 검증이 필요합니다.',
      M,
      608,
      540,
      34,
      {
        fontSize: 16,
        color: C.muted,
        lineSpacing: 1,
      },
    );
    addRect(slide, 'cover-image-bg', 650, 38, 582, 604, C.ink, C.ink, 1);
    const bytes = await fs.readFile(SCREENSHOT);
    slide.images.add({
      blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      contentType: 'image/png',
      alt: 'GiwaPay public non-transactional Korean showcase with testnet checkout preview',
      fit: 'contain',
      position: { left: 650, top: 38, width: 582, height: 604 },
      geometry: 'rect',
    });
    addNotes(
      slide,
      '첫 문장은 제품 약속입니다. 동시에 공개 쇼케이스가 비거래형이며, 실제 GIWA 배포를 아직 주장하지 않는다는 경계를 짚습니다.',
      [
        'https://giwapay-mvp.eomyunsig.chatgpt.site',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/README.md',
        'https://giwa.io/gasok',
      ],
    );
  }

  // 02 — Problem (Codex Grid slide 10 paired narrative)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      2,
      '결제보다 어려운 것은 정확한 정산과 증명입니다',
      '판매자의 운영 문제는 지갑 버튼을 추가하는 것만으로 끝나지 않습니다.',
    );
    addText(slide, 'problem-left-kicker', 'ASSET MISMATCH', M, 214, 500, 28, {
      fontSize: 18,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(
      slide,
      'problem-left-message',
      '고객이 보유한 지원 자산\n≠\n판매자가 받을 자산',
      M,
      260,
      500,
      230,
      {
        fontSize: 46,
        bold: true,
        lineSpacing: 0.92,
      },
    );
    addText(
      slide,
      'problem-left-consequence',
      '라우팅, 최대 입력액, 수수료, 분할 정산과 미사용 입력 환불을 한 조건으로 묶어야 합니다.',
      M,
      522,
      500,
      82,
      {
        fontSize: 22,
        color: C.muted,
        lineSpacing: 1.05,
      },
    );

    addRule(slide, 'problem-vertical-rule', 624, 196, 1, 422, C.ink);
    const risks = [
      ['01', '해시 제출 ≠ 결제 성공', '브라우저 콜백은 canonical 이벤트를 증명하지 못합니다.'],
      ['02', '부분 성공은 정산 실패', '교환·수수료·분배·환불이 따로 움직이면 금액이 어긋납니다.'],
      ['03', '수탁 잔액은 부담 확대', '중간 잔액은 키 관리·운영·규제 경계를 더 복잡하게 만듭니다.'],
    ];
    risks.forEach((risk, index) => {
      const top = 212 + index * 132;
      addText(slide, `problem-risk-num-${index}`, risk[0], 674, top, 52, 28, {
        fontSize: 18,
        bold: true,
        color: C.accentDark,
        typeface: FONT_EN,
        lineSpacing: 1,
      });
      addText(slide, `problem-risk-title-${index}`, risk[1], 742, top - 2, 450, 32, {
        fontSize: 26,
        bold: true,
        lineSpacing: 1,
      });
      addText(slide, `problem-risk-body-${index}`, risk[2], 742, top + 40, 450, 56, {
        fontSize: 20,
        color: C.muted,
        lineSpacing: 1.05,
      });
      if (index < 2) {
        addRule(slide, `problem-risk-rule-${index}`, 674, top + 112, 518, 1);
      }
    });
    addFooter(slide, 2);
    addNotes(
      slide,
      '문제는 결제 자산 선택이 아니라 정확한 정산과 성공 판정입니다. 수탁 없이 이 문제를 해결하려면 실행과 검증을 하나의 제품 흐름으로 묶어야 합니다.',
      [
        'https://github.com/eomyunsig-debug/giwapay/blob/main/README.md',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/docs/architecture.md',
      ],
    );
  }

  // 03 — Solution (Codex Grid slide 07 three-step process)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      3,
      '서명 → 실행 → canonical 검증으로 결제를 증명합니다',
      '성공은 버튼이 아니라 체인 증거가 결정합니다.',
    );

    // Connectors first, so they stay behind the milestones.
    addRect(slide, 'solution-connector-1', 210, 262, 330, 2, C.rule);
    addRect(slide, 'solution-connector-2', 624, 262, 330, 2, C.rule);
    const centers = [160, 576, 990];
    centers.forEach((center, index) => {
      addRect(
        slide,
        `solution-node-${index}`,
        center - 22,
        240,
        44,
        44,
        index === 2 ? C.accent : C.ink,
        'none',
        0,
        'ellipse',
      );
      addText(slide, `solution-node-number-${index}`, String(index + 1), center - 18, 250, 36, 22, {
        fontSize: 18,
        bold: true,
        color: index === 2 ? C.ink : C.white,
        alignment: 'center',
        typeface: FONT_EN,
        lineSpacing: 1,
      });
    });

    const steps = [
      {
        left: 48,
        title: '판매자가 조건을 고정',
        body: 'EIP-712 PaymentIntent에 정산 토큰·정확 금액·수령인·수수료·만료·splitHash를 묶습니다.',
      },
      {
        left: 464,
        title: '고객이 직접 실행',
        body: '예상액과 최대 입력액을 확인하고, 필요할 때만 승인한 뒤 PaymentRouter를 호출합니다.',
      },
      {
        left: 878,
        title: '체인이 성공을 판정',
        body: '인덱서가 canonical 이벤트와 실제 분배를 검증한 뒤에만 영수증과 웹훅을 만듭니다.',
      },
    ];
    steps.forEach((step, index) => {
      addText(slide, `solution-step-title-${index}`, step.title, step.left, 326, 350, 42, {
        fontSize: 28,
        bold: true,
        lineSpacing: 1,
      });
      addText(slide, `solution-step-body-${index}`, step.body, step.left, 388, 350, 118, {
        fontSize: 21,
        color: C.muted,
        lineSpacing: 1.08,
      });
    });

    addRect(slide, 'solution-zero-balance-bg', M, 556, 1184, 72, C.ink);
    addText(
      slide,
      'solution-zero-balance',
      'GiwaPay balance = 0  ·  결제·선택적 교환·수수료·분배·잔돈 환불은 모두 실행되거나 모두 되돌아갑니다',
      M + 24,
      578,
      1136,
      28,
      {
        fontSize: 21,
        bold: true,
        color: C.white,
        lineSpacing: 1,
      },
    );
    addFooter(slide, 3);
    addNotes(
      slide,
      '세 단계만 기억하면 됩니다. 판매자가 조건을 서명하고, 고객이 직접 실행하며, 독립 인덱서가 canonical 사실을 확인합니다. 트랜잭션 사이에 GiwaPay 잔액은 없습니다.',
      [
        'https://github.com/eomyunsig-debug/giwapay/blob/main/docs/architecture.md',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/README.md',
      ],
    );
  }

  // 04 — Why GIWA (Codex Grid slide 07 silhouette, truth-boundary rail)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      4,
      'GIWA는 빠른 체감과 검증된 정산을 함께 설계하게 합니다',
      '현재 기능, 향후 Wallet 표면, 정산의 진실을 분리해 구현합니다.',
    );
    const columns = [
      {
        left: 48,
        label: 'PRECONFIRMATION',
        title: 'Flashblocks',
        body: '제출 직후 체감 피드백을 빠르게 만들 수 있습니다.\n\n사전확인이지 finality는 아닙니다.',
      },
      {
        left: 458,
        label: 'PAYMENT SURFACE',
        title: 'GIWA Wallet',
        body: 'provider·account·chain handoff로 반복 연결 화면을 줄이는 인앱 결제 경계를 제안합니다.\n\n공식 SDK 전까지 proposal입니다.',
      },
      {
        left: 868,
        label: 'TRUST SIGNAL',
        title: 'Dojang · up.id',
        body: '결제 실행과 분리된 merchant identity signal로 확장할 수 있습니다.\n\n파트너십이나 결제 성공을 뜻하지 않습니다.',
      },
    ];
    columns.forEach((column, index) => {
      addText(slide, `giwa-label-${index}`, column.label, column.left, 220, 340, 26, {
        fontSize: 17,
        bold: true,
        color: C.accentDark,
        typeface: FONT_EN,
        lineSpacing: 1,
      });
      addText(slide, `giwa-title-${index}`, column.title, column.left, 264, 340, 44, {
        fontSize: 30,
        bold: true,
        lineSpacing: 1,
      });
      addRule(slide, `giwa-rule-${index}`, column.left, 324, 340, 1);
      addText(slide, `giwa-body-${index}`, column.body, column.left, 350, 340, 180, {
        fontSize: 21,
        color: C.muted,
        lineSpacing: 1.08,
      });
    });
    addRect(slide, 'giwa-truth-bg', M, 558, 1184, 70, C.accentPale);
    addText(
      slide,
      'giwa-truth',
      '정산의 진실 = confirmation-aware indexer가 확인한 canonical event',
      M + 24,
      580,
      1136,
      28,
      {
        fontSize: 24,
        bold: true,
        color: C.accentDark,
        lineSpacing: 1,
      },
    );
    addFooter(slide, 4);
    addNotes(
      slide,
      'Flashblocks는 제출 체감을 개선할 수 있지만 정산 finality로 사용하지 않습니다. GIWA Wallet은 공식 인터페이스가 공개되기 전까지 제안 경계이며, Dojang과 up.id도 결제 실행과 분리합니다.',
      [
        'https://docs.giwa.io/giwa-chain/en',
        'https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa',
        'https://docs.giwa.io/giwa-chain/en/network-information/transaction-fees',
        'https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang',
        'https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/giwa-id',
        'https://docs.giwa.io/giwa-chain/en/terms-and-policies/testnet-terms-of-use',
        'https://github.com/eomyunsig-debug/giwapay/blob/agent/giwa-program-submission/docs/giwa-wallet-embedded-mode.md',
      ],
    );
  }

  // 05 — Implementation evidence and pending hard gate (Codex Grid slide 10)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      5,
      '구현된 스택과 아직 남은 하드 게이트를 분리했습니다',
      '코드의 깊이는 증거로, 미배포 상태는 경계로 보여줍니다.',
    );
    addText(slide, 'evidence-label', 'IMPLEMENTED · REPRODUCIBLE', M, 212, 700, 26, {
      fontSize: 18,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    const implemented = [
      ['01', 'Solidity', 'MerchantRegistry · AdapterRegistry · non-upgradeable PaymentRouter'],
      ['02', 'Application', 'Fastify API · EIP-712 · SIWE/ERC-1271 · PostgreSQL'],
      [
        '03',
        'Truth layer',
        'confirmation-aware indexer · reorg rollback · verified split snapshot',
      ],
      [
        '04',
        'Product & QA',
        'checkout · dashboard · SDK · 4 green CI jobs · 44 Foundry total (5 invariant)',
      ],
    ];
    implemented.forEach((item, index) => {
      const top = 258 + index * 76;
      addText(slide, `evidence-num-${index}`, item[0], M, top, 42, 24, {
        fontSize: 17,
        bold: true,
        color: C.accentDark,
        typeface: FONT_EN,
        lineSpacing: 1,
      });
      addText(slide, `evidence-title-${index}`, item[1], 106, top - 2, 168, 30, {
        fontSize: 24,
        bold: true,
        lineSpacing: 1,
      });
      addText(slide, `evidence-body-${index}`, item[2], 278, top, 472, 48, {
        fontSize: 19,
        color: C.muted,
        lineSpacing: 1.05,
      });
      if (index < implemented.length - 1) {
        addRule(slide, `evidence-row-rule-${index}`, M, top + 58, 702, 1);
      }
    });

    addRect(slide, 'hard-gate-panel', 794, 204, 438, 398, C.ink);
    addText(slide, 'hard-gate-kicker', 'PENDING HARD GATE', 824, 236, 378, 28, {
      fontSize: 18,
      bold: true,
      color: C.accent,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(slide, 'hard-gate-title', '검증된 GIWA\n테스트넷 계약', 824, 286, 378, 104, {
      fontSize: 40,
      bold: true,
      color: C.white,
      lineSpacing: 0.92,
    });
    addText(
      slide,
      'hard-gate-body',
      '1. production-mode 배포\n2. GIWA Explorer 소스 검증\n3. 주소·tx·commit 공개 manifest',
      824,
      420,
      378,
      112,
      {
        fontSize: 22,
        color: C.white,
        lineSpacing: 1.18,
      },
    );
    addText(
      slide,
      'hard-gate-disclaimer',
      '현재 live 주소·공식 Wallet 연동·외부 보안감사는 주장하지 않습니다.',
      824,
      548,
      366,
      44,
      {
        fontSize: 16,
        color: C.panelStrong,
        lineSpacing: 1,
      },
    );
    addFooter(slide, 5);
    addNotes(
      slide,
      '왼쪽은 저장소에서 재현 가능한 구현입니다. 오른쪽은 GASOK 제출 전 완료해야 하는 하드 게이트입니다. 테스트 자동화는 외부 감사로 표현하지 않습니다.',
      [
        'https://github.com/eomyunsig-debug/giwapay',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/docs/testing.md',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/docs/deployment.md',
        'https://github.com/eomyunsig-debug/giwapay/actions/runs/30518612814',
        'https://sepolia-explorer.giwa.io',
      ],
    );
  }

  // 06 — Market scenario range (Codex Grid slide 19 metrics)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      6,
      '시장 가정은 범위로, 공개 확인 실적은 별도로 표시합니다',
      '참고 시장, 가정 기반 처리액, 현재 증거를 같은 숫자로 섞지 않습니다.',
    );
    addText(
      slide,
      'market-reference',
      '2025 비면세 온라인 해외직접판매 1.9621조원은 넓은 참고 기준일 뿐,\nGiwaPay의 TAM·획득 가능 시장·현재 GMV가 아닙니다.',
      M,
      194,
      1184,
      72,
      {
        fontSize: 23,
        color: C.muted,
        lineSpacing: 1.08,
      },
    );
    const metrics = [
      ['0.981억', 'LOW · 연간 처리액', '0.5% 예시 수수료 49만원\n적격 0.1% × checkout 5%'],
      ['9.811억', 'BASE · 연간 처리액', '0.5% 예시 수수료 491만원\n적격 0.5% × checkout 10%'],
      ['39.24억', 'HIGH · 연간 처리액', '0.5% 예시 수수료 1,962만원\n적격 1.0% × checkout 20%'],
    ];
    metrics.forEach((metric, index) => {
      const left = 48 + index * 410;
      addRect(
        slide,
        `market-panel-${index}`,
        left,
        310,
        364,
        244,
        index === 1 ? C.accentPale : C.panel,
      );
      addText(slide, `market-stat-${index}`, metric[0], left + 24, 334, 316, 90, {
        fontSize: 52,
        bold: true,
        color: index === 1 ? C.accentDark : C.ink,
        typeface: FONT_EN,
        lineSpacing: 0.9,
      });
      addText(slide, `market-title-${index}`, metric[1], left + 24, 438, 316, 34, {
        fontSize: 26,
        bold: true,
        lineSpacing: 1,
      });
      addText(slide, `market-body-${index}`, metric[2], left + 24, 490, 316, 50, {
        fontSize: 18,
        color: C.muted,
        lineSpacing: 1.05,
      });
    });
    addText(
      slide,
      'market-zero',
      '공개 확인 실적: 인터뷰 0 · 서면 관심 0 · merchant 통합 0  /  비공개·오프라인 활동은 신청자 확인 필요',
      M,
      590,
      1184,
      28,
      {
        fontSize: 18,
        bold: true,
        color: C.danger,
        lineSpacing: 1,
      },
    );
    addFooter(slide, 6);
    addNotes(
      slide,
      '1.9621조원은 거시 참고 기준이며 GiwaPay TAM으로 사용하지 않습니다. Low/Base/High는 각각 98,105,000원, 981,050,000원, 3,924,200,000원의 가정 기반 연간 처리액입니다. 0.5% 예시 수수료는 490,525원, 4,905,250원, 19,621,000원입니다. 저장소와 공개 자료에서 검증된 인터뷰·서면 관심·merchant 통합은 모두 0이며, 비공개·오프라인 활동은 신청자가 확인해야 합니다.',
      [
        'https://mods.go.kr/boardDownload.es?bid=241&list_no=443337&seq=1',
        'https://github.com/eomyunsig-debug/giwapay/blob/agent/giwa-program-submission/docs/market-opportunity.md',
      ],
    );
  }

  // 07 — Eight-week sequence and KPIs (Codex Grid slide 17 timeline)
  {
    const slide = newSlide(presentation);
    addSlideTitle(
      slide,
      7,
      '8주 뒤에는 결정 가능한 결제 데이터를 냅니다',
      '먼저 배포 증거, 다음으로 수요와 Wallet 경계, 마지막으로 파일럿과 보안 검토입니다.',
    );

    // Timeline first.
    addRect(slide, 'roadmap-line', 112, 294, 1020, 2, C.ink);
    const nodes = [160, 576, 990];
    nodes.forEach((center, index) => {
      addRect(
        slide,
        `roadmap-node-${index}`,
        center - 9,
        286,
        18,
        18,
        index === 0 ? C.accent : C.ink,
        'none',
        0,
        'ellipse',
      );
    });
    const phases = [
      {
        left: 48,
        label: 'NOW · SUBMISSION GATE',
        title: '검증 계약',
        body: 'GIWA Sepolia 배포\nExplorer 소스 검증\npublic manifest',
      },
      {
        left: 464,
        label: 'WEEK 1–2',
        title: '수요 · Wallet 경계',
        body: '15 interviews\n3 written interests\nofficial host contract 논의',
      },
      {
        left: 878,
        label: 'WEEK 3–8',
        title: '파일럿 · 보안',
        body: '2 testnet integrations\n각 ≥20 disposable payments\nexternal contract review',
      },
    ];
    phases.forEach((phase, index) => {
      addText(slide, `roadmap-label-${index}`, phase.label, phase.left, 220, 350, 24, {
        fontSize: 17,
        bold: true,
        color: C.accentDark,
        typeface: FONT_EN,
        lineSpacing: 1,
      });
      addText(slide, `roadmap-title-${index}`, phase.title, phase.left, 336, 350, 40, {
        fontSize: 28,
        bold: true,
        lineSpacing: 1,
      });
      addText(slide, `roadmap-body-${index}`, phase.body, phase.left, 396, 350, 106, {
        fontSize: 21,
        color: C.muted,
        lineSpacing: 1.15,
      });
    });

    addRect(slide, 'roadmap-kpi-bg', M, 548, 1184, 84, C.panel);
    addText(slide, 'roadmap-kpi-label', 'PILOT DECISION GATE', M + 22, 566, 230, 24, {
      fontSize: 16,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(
      slide,
      'roadmap-kpi',
      'canonical receipt 성공률 ≥95%* · setup time · receipt latency · 단계별 실패 분류',
      M + 250,
      564,
      950,
      30,
      {
        fontSize: 22,
        bold: true,
        lineSpacing: 1,
      },
    );
    addText(
      slide,
      'roadmap-kpi-note',
      '* 성공한 onchain payments가 합의된 test window 안에 기대한 canonical receipt를 만드는 비율. 현재 성과가 아닌 파일럿 gate.',
      M + 250,
      600,
      932,
      22,
      {
        fontSize: 16,
        color: C.muted,
        lineSpacing: 1,
      },
    );
    addFooter(slide, 7);
    addNotes(
      slide,
      '순서를 바꾸지 않습니다. 제출 전에는 검증 계약, Phase 3 초반에는 수요와 Wallet 경계, 후반에는 실제 테스트넷 운영과 외부 계약 리뷰를 진행합니다.',
      [
        'https://github.com/eomyunsig-debug/giwapay/blob/agent/giwa-program-submission/docs/market-opportunity.md',
        'https://github.com/eomyunsig-debug/giwapay/blob/agent/giwa-program-submission/docs/giwa-wallet-embedded-mode.md',
        'https://github.com/eomyunsig-debug/giwapay/blob/main/docs/testing.md',
      ],
    );
  }

  // 08 — Close (Codex Grid slide 26 sparse close)
  {
    const slide = newSlide(presentation);
    addText(slide, 'close-eyebrow', 'GASOK DECISION', M, 42, 320, 28, {
      fontSize: 18,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(
      slide,
      'close-title',
      'GiwaPay를 GIWA의\n‘실제로 쓸 수 있는 결제’로\n증명하겠습니다',
      M,
      148,
      950,
      270,
      {
        fontSize: 66,
        bold: true,
        lineSpacing: 0.88,
      },
    );
    addRule(slide, 'close-rule', M, 466, 1184, 1, C.ink);
    addText(slide, 'close-team-label', 'TEAM', M, 506, 92, 24, {
      fontSize: 16,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(
      slide,
      'close-team',
      'Product & engineering · public profile pending',
      146,
      504,
      520,
      28,
      {
        fontSize: 21,
        bold: true,
        typeface: FONT_EN,
        lineSpacing: 1,
      },
    );
    addText(slide, 'close-ask-label', 'GASOK ASK', M, 556, 108, 24, {
      fontSize: 16,
      bold: true,
      color: C.accentDark,
      typeface: FONT_EN,
      lineSpacing: 1,
    });
    addText(
      slide,
      'close-ask',
      '검증 배포 리뷰  ·  공식 Wallet host 경계  ·  소규모 merchant pilot 연결',
      166,
      552,
      820,
      34,
      {
        fontSize: 22,
        bold: true,
        lineSpacing: 1,
      },
    );
    addRect(slide, 'close-status-bg', 1010, 522, 222, 76, C.ink);
    addText(slide, 'close-status-label', 'VERIFIED CONTRACT', 1028, 540, 188, 20, {
      fontSize: 16,
      bold: true,
      color: C.accent,
      typeface: FONT_EN,
      alignment: 'center',
      lineSpacing: 1,
    });
    addText(slide, 'close-status-value', 'PENDING', 1028, 566, 188, 22, {
      fontSize: 18,
      bold: true,
      color: C.white,
      typeface: FONT_EN,
      alignment: 'center',
      lineSpacing: 1,
    });
    addText(
      slide,
      'close-link',
      'giwapay-mvp.eomyunsig.chatgpt.site  ·  github.com/eomyunsig-debug/giwapay',
      M,
      632,
      900,
      22,
      {
        fontSize: 16,
        color: C.muted,
        typeface: FONT_EN,
        lineSpacing: 1,
      },
    );
    addNotes(
      slide,
      '마지막 요청은 세 가지입니다. 검증 배포를 함께 확인하고, 공식 Wallet host 경계를 합의하며, 작은 merchant pilot로 실제 결제 데이터를 만들겠습니다.',
      [
        'https://giwapay-mvp.eomyunsig.chatgpt.site',
        'https://github.com/eomyunsig-debug/giwapay',
        'https://giwa.io/gasok',
      ],
    );
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, '0')}`;
    const png = await presentation.export({ slide, format: 'png', scale: 1 });
    await fs.writeFile(
      path.join(TMP_DIR, 'artifact-render', `${stem}.png`),
      new Uint8Array(await png.arrayBuffer()),
    );
    const layout = await slide.export({ format: 'layout' });
    await fs.writeFile(
      path.join(TMP_DIR, 'artifact-render', `${stem}.layout.json`),
      await layout.text(),
    );
  }

  const snapshot = await presentation.inspect({
    kind: 'slide,textbox,shape,image,notes',
    maxChars: 50000,
  });
  await fs.writeFile(path.join(TMP_DIR, 'artifact-render', 'deck-inspect.ndjson'), snapshot.ndjson);

  const tempPptx = path.join(TMP_DIR, 'GiwaPay-GASOK-Pitch-Deck.pptx');
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(tempPptx);
  await fs.copyFile(tempPptx, FINAL_PPTX);

  const pdfResult = spawnSync(
    process.env.GIWAPAY_DECK_PYTHON ?? 'python3',
    [
      PDF_ASSEMBLER,
      '--input-dir',
      path.join(TMP_DIR, 'artifact-render'),
      '--output',
      FINAL_PDF,
      '--montage-output',
      path.join(TMP_DIR, 'artifact-render', 'deck-montage.webp'),
    ],
    { stdio: 'inherit' },
  );
  if (pdfResult.status !== 0) {
    throw new Error(
      'PDF assembly failed. Set GIWAPAY_DECK_PYTHON to a Python interpreter with Pillow installed.',
    );
  }
  writeLog(FINAL_PPTX);
  writeLog(FINAL_PDF);
}

build().catch((buildError) => {
  writeError(buildError);
  process.exitCode = 1;
});

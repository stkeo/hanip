// 공유용 이미지 카드 (canvas) — 같이 먹은 식사 카드 4:5, 개인 리포트·월말 결산 9:16(인스타 스토리).
// BLUE TABLE: 코발트 + 백자, 음식 사진은 원형 접시에 담고 글꼴은 Pretendard 800 하나.
import { loadImage } from './image.js?v=202610181846';
import { METRICS, dateLabelLong, fmt1, monthLabel } from './logic.js?v=202610181846';

const FONT = "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
// 앱 토큰(css/app.css :root)과 같은 값. 캔버스는 CSS 변수를 못 읽어 값을 옮겨 둔다.
const C = {
  blue: '#244BDB', bg: '#FAFCFF', paper: '#FFFFFF', soft: '#EEF3FC', line: '#DCE4F2',
  ink: '#172A3A', sub: '#4F6173', faint: '#5A6A7C', lemon: '#EEF2AE', gold: '#F5B301', onBlueSub: '#E4EBFF',
};
const TAGLINE = '친구들과 쌓아가는 식탁';

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

// 한글은 글자 묶음별로 따로 받아지므로 그릴 글자를 미리 받아 둔다. 못 받으면 시스템 굵은 글꼴로 그린다.
async function fontsReady(text = '') {
  const sample = `한입 0123456789 ${text}`;
  try {
    await Promise.all([800, 700, 500].map((w) => document.fonts.load(font(w, 48), sample)));
  } catch {
    /* 폰트가 없어도 시스템 글꼴로 그린다 */
  }
}

function rr(ctx, x, y, w, hgt, r) {
  const k = Math.min(r, w / 2, hgt / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, k);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, k);
  ctx.arcTo(x, y + hgt, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

async function tryLoad(url) {
  if (!url) return null;
  const local = url.startsWith('data:') || url.startsWith('blob:');
  try {
    return await loadImage(url, { cors: !local });
  } catch {
    return null;
  }
}

function ring(ctx, cx, cy, r, color, width) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// 사진이 없거나 못 불러오면: 흰 접시 + 이중 코발트 링 + 가게 첫 글자
function plateFill(ctx, cx, cy, r, label) {
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ring(ctx, cx, cy, r - r * 0.05, C.blue, Math.max(3, r * 0.05));
  ring(ctx, cx, cy, r * 0.8, C.blue, Math.max(2, r * 0.018));
  ctx.fillStyle = C.blue;
  ctx.font = font(800, r * 0.72);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Array.from(String(label || '').trim())[0] || '?', cx, cy + r * 0.04);
}

// 사각 틀에 사진 채우기(없으면 옅은 블루 + 접시)
function cover(ctx, img, x, y, w, hgt, r, fallback) {
  ctx.save();
  rr(ctx, x, y, w, hgt, r);
  ctx.clip();
  if (img) {
    const s = Math.max(w / img.naturalWidth, hgt / img.naturalHeight);
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (hgt - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = C.soft;
    ctx.fillRect(x, y, w, hgt);
    plateFill(ctx, x + w / 2, y + hgt / 2, Math.min(w, hgt) * 0.32, fallback);
  }
  ctx.restore();
}

// 원형 접시에 담은 사진: 흰 두꺼운 테 + 얇은 코발트 링
function dish(ctx, img, cx, cy, r, label) {
  ctx.save();
  ctx.shadowColor = 'rgba(16, 27, 45, 0.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const inner = r * 0.9;
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max((inner * 2) / img.naturalWidth, (inner * 2) / img.naturalHeight);
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
    ctx.restore();
    ring(ctx, cx, cy, inner + r * 0.035, C.blue, Math.max(3, r * 0.016));
  } else {
    plateFill(ctx, cx, cy, r, label);
  }
}

function fit(ctx, text, maxW) {
  const s = String(text ?? '');
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// 긴 문장을 최대 lines줄로 나눈다(띄어쓰기 기준, 넘치면 마지막 줄 말줄임)
function wrap(ctx, text, maxW, lines = 2) {
  const words = String(text ?? '').split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  if (out.length > lines) out.splice(lines - 1, out.length, out.slice(lines - 1).join(' '));
  return out.map((l) => fit(ctx, l, maxW));
}

// 워드마크: 한입 + 이중 링
function wordmark(ctx, x, y, size, color) {
  ctx.font = font(800, size);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('한입', x, y);
  const tw = ctx.measureText('한입').width;
  const r = size * 0.44;
  const cx = x + tw + size * 0.1 + r;
  ring(ctx, cx, y, r, color, Math.max(2, size * 0.07));
  ring(ctx, cx, y, r * 0.74, color, Math.max(2, size * 0.07));
  return cx + r - x;
}

function photoGrid(ctx, imgs, labels, x, y, w, hgt, gap, r) {
  const n = Math.min(imgs.length, 4);
  if (n === 1) cover(ctx, imgs[0], x, y, w, hgt, r, labels[0]);
  else if (n === 2) {
    const cw = (w - gap) / 2;
    cover(ctx, imgs[0], x, y, cw, hgt, r, labels[0]);
    cover(ctx, imgs[1], x + cw + gap, y, cw, hgt, r, labels[1]);
  } else if (n === 3) {
    const cw = (w - gap) * 0.58;
    const rw = w - gap - cw;
    const rh = (hgt - gap) / 2;
    cover(ctx, imgs[0], x, y, cw, hgt, r, labels[0]);
    cover(ctx, imgs[1], x + cw + gap, y, rw, rh, r, labels[1]);
    cover(ctx, imgs[2], x + cw + gap, y + rh + gap, rw, rh, r, labels[2]);
  } else {
    const cw = (w - gap) / 2;
    const ch = (hgt - gap) / 2;
    [0, 1, 2, 3].forEach((i) =>
      cover(ctx, imgs[i], x + (i % 2) * (cw + gap), y + Math.floor(i / 2) * (ch + gap), cw, ch, r, labels[i]));
  }
}

function star(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ---- 같이 먹은 식사 카드 (1080×1350) ----

export async function drawMealCard({ groupName, card }) {
  const names = card.posts.map((p) => p.nickname).join(' · ');
  await fontsReady(`${card.place} ${groupName} ${names} 같이 먹은 한 끼 함께한 사람 맛 가성비 추천`);
  const W = 1080;
  const H = 1350;
  const P = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  // 위: 큰 사진(2명이면 두 장 나란히). 사진이 하나도 없으면 접시 한 장.
  const withPhoto = card.posts.filter((p) => p.photoUrl).slice(0, 4);
  const imgs = await Promise.all(withPhoto.map((p) => tryLoad(p.photoUrl)));
  const gy = P;
  const gh = 660;
  if (withPhoto.length) photoGrid(ctx, imgs, withPhoto.map((p) => p.place || card.place), P, gy, W - 2 * P, gh, 16, 36);
  else cover(ctx, null, P, gy, W - 2 * P, gh, 36, card.place);

  // 가게 이름·동네·날짜
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(800, 76);
  ctx.fillStyle = C.ink;
  ctx.fillText(fit(ctx, card.place, W - 2 * P), P, gy + gh + 112);
  const area = card.posts.find((p) => p.area)?.area || '';
  ctx.font = font(500, 32);
  ctx.fillStyle = C.sub;
  ctx.fillText(fit(ctx, [area, dateLabelLong(card.eatenOn)].filter(Boolean).join(' · '), W - 2 * P), P, gy + gh + 166);

  // 세 칸 평균: 라벨 / 금색 별 + 소수 한 자리
  const by = gy + gh + 210;
  const bh = 170;
  ctx.fillStyle = C.soft;
  rr(ctx, P, by, W - 2 * P, bh, 28);
  ctx.fill();
  const cw = (W - 2 * P) / METRICS.length;
  METRICS.forEach((m, i) => {
    const cx = P + cw * i + cw / 2;
    if (i) {
      ctx.fillStyle = C.line;
      ctx.fillRect(P + cw * i, by + 30, 2, bh - 60);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(500, 28);
    ctx.fillStyle = C.sub;
    ctx.fillText(m.label, cx, by + 50);
    ctx.font = font(800, 50);
    const t = fmt1(card.averages[m.key]);
    const tw = ctx.measureText(t).width;
    star(ctx, cx - tw / 2 - 8, by + 112, 22, C.gold);
    ctx.fillStyle = C.ink;
    ctx.fillText(t, cx + 22, by + 114);
  });

  // 함께한 사람
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(500, 28);
  ctx.fillStyle = C.sub;
  ctx.fillText(`함께한 사람 ${card.posts.length}명`, P, by + bh + 64);
  ctx.font = font(700, 34);
  ctx.fillStyle = C.ink;
  ctx.fillText(fit(ctx, names, W - 2 * P), P, by + bh + 110);

  // 아래: 워드마크 + 모임 이름
  const fy = H - 60;
  ctx.fillStyle = C.line;
  ctx.fillRect(P, fy - 50, W - 2 * P, 2);
  const ww = wordmark(ctx, P, fy, 40, C.blue);
  ctx.font = font(500, 28);
  ctx.fillStyle = C.sub;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, groupName, W - 2 * P - ww - 40), W - P, fy);
  return c;
}

// ---- 9:16 틀(개인 리포트·월말 결산 공용) ----
// 위 코발트 면: 워드마크·작은 줄·큰 문장·원형 접시 사진 / 아래 흰 카드: 큰 숫자 줄·항목 행·작은 링 + 문구
async function storyCard({ kicker, headline, photo, photoLabel, count, countUnit, rows, demo, emptyText }) {
  const W = 1080;
  const H = 1920;
  const P = 72;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = C.blue;
  ctx.fillRect(0, 0, W, H);

  // 장식: 오른쪽 위 큰 이중 링 + 레몬 동그라미 하나
  ring(ctx, W + 30, 40, 240, 'rgba(255,255,255,0.9)', 16);
  ring(ctx, W + 30, 40, 196, 'rgba(255,255,255,0.55)', 5);
  ctx.fillStyle = C.lemon;
  ctx.beginPath();
  ctx.arc(W - 250, 250, 58, 0, Math.PI * 2);
  ctx.fill();

  wordmark(ctx, P, 150, 84, C.paper);
  ctx.font = font(600, 40);
  ctx.fillStyle = C.onBlueSub;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fit(ctx, kicker, W - 2 * P - 380), P, 262);

  ctx.font = font(800, 104);
  ctx.fillStyle = C.paper;
  wrap(ctx, headline, W - 2 * P, 2).forEach((line, i) => ctx.fillText(line, P, 420 + i * 124));

  const panelY = 1170;
  if (photo !== undefined) dish(ctx, photo, W / 2 + 130, 880, 310, photoLabel);

  // 아래 흰 카드
  ctx.save();
  ctx.shadowColor = 'rgba(16, 27, 45, 0.22)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = C.paper;
  rr(ctx, 40, panelY, W - 80, H - panelY - 40, 48);
  ctx.fill();
  ctx.restore();
  const X = 100;
  const R = W - 100;
  if (emptyText) {
    ctx.font = font(800, 60);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, emptyText, R - X), X, panelY + 150);
  } else {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(800, 150);
    ctx.fillStyle = C.blue;
    const n = String(count);
    ctx.fillText(n, X - 6, panelY + 176);
    const nw = ctx.measureText(n).width;
    ctx.font = font(800, 66);
    ctx.fillStyle = C.ink;
    ctx.fillText(fit(ctx, countUnit, R - X - nw - 12), X + nw + 6, panelY + 172);
    let y = panelY + 218;
    for (const [label, value] of rows.filter((r) => r[1]).slice(0, 4)) {
      ctx.fillStyle = C.line;
      ctx.fillRect(X, y, R - X, 2);
      ctx.font = font(500, 38);
      ctx.fillStyle = C.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, X, y + 47);
      const lw = ctx.measureText(label).width;
      ctx.font = font(800, 44);
      ctx.fillStyle = C.blue;
      ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, value, R - X - lw - 40), R, y + 47);
      y += 90;
    }
  }
  // 맨 아래: 작은 이중 링 + 문구(체험이면 오른쪽에 작게)
  const fy = H - 96;
  ctx.fillStyle = C.line;
  ctx.fillRect(X, fy - 58, R - X, 2);
  ring(ctx, X + 26, fy, 26, C.blue, 5);
  ring(ctx, X + 26, fy, 18, C.blue, 4);
  ctx.font = font(500, 34);
  ctx.fillStyle = C.sub;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(TAGLINE, X + 72, fy + 2);
  if (demo) {
    ctx.font = font(500, 28);
    ctx.fillStyle = C.faint;
    ctx.textAlign = 'right';
    ctx.fillText('체험용 예시', R, fy + 2);
  }
  return c;
}

// ---- 월말 결산 카드 (1080×1920) ----
// taste(선택): monthlyTaste 결과를 넘기면 '가장 자주 먹은 종류' 행을 넣는다.
export async function drawMonthCard({ scopeName, summary: s, isGroup, taste = null }) {
  const month = monthLabel(s.ym);
  const mv = s.mostVisited;
  const fav = taste?.favorite;
  const rows = [
    fav ? ['가장 자주 먹은 종류', `${fav.label} ${fav.count}회`] : null,
    mv ? ['이달의 한입', mv.place] : null,
    isGroup ? ['같이 먹은 날', `${s.mealCount}번`] : null,
    s.bestRecommend ? ['추천 1위', s.bestRecommend.place] : null,
    s.bestWorth ? ['가성비왕', s.bestWorth.place] : null,
  ].filter(Boolean);
  const headline = `${month} 결산`;
  await fontsReady(`${scopeName} ${headline} 번의 식사 ${rows.flat().join(' ')} 이달엔 아직 기록이 없어요 ${TAGLINE}`);
  return storyCard({
    kicker: `${scopeName} · ${month}`,
    headline,
    photo: mv ? await tryLoad(mv.photoUrl) : undefined,
    photoLabel: mv?.place,
    count: s.total,
    countUnit: '번의 식사',
    rows,
    emptyText: s.total ? '' : '이달엔 아직 기록이 없어요',
  });
}

// ---- 개인 리포트 카드 (1080×1920) ----
// 실제 값만 넣는다. 체험 통계는 저장 이미지에도 예시임을 남긴다.
export async function drawReportCard({ name, summary: s, taste, rankText = '', demo = false }) {
  const month = monthLabel(s.ym);
  const mv = s.mostVisited;
  const fav = taste.favorite;
  const rows = [
    fav ? ['가장 자주 먹은 종류', `${fav.label} ${fav.count}회`] : null,
    mv ? ['이달의 한입', mv.place] : null,
    taste.title ? ['이번 달의 칭호', taste.title] : null,
    rankText && fav ? [`${fav.label} 기록`, rankText] : null,
  ].filter(Boolean);
  const headline = taste.title ? `이번 달은 ${taste.title}` : '잘 먹은 날은 오래 남으니까.';
  await fontsReady(`${name}의 ${month} ${headline} 번의 맛있는 순간 ${rows.flat().join(' ')} ${TAGLINE} 체험용 예시`);
  return storyCard({
    kicker: `${name}의 ${month}`,
    headline,
    photo: mv ? await tryLoad(mv.photoUrl) : undefined,
    photoLabel: mv?.place,
    count: s.total,
    countUnit: '번의 맛있는 순간',
    rows,
    demo,
    emptyText: s.total ? '' : '이달엔 아직 기록이 없어요',
  });
}

// ---- 저장·공유 ----

export async function shareCanvas(canvas, filename, title) {
  let blob;
  try {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  } catch {
    blob = null; // 다른 도메인 사진 때문에 canvas가 오염되면 여기로 온다
  }
  if (!blob) throw new Error('card_export_failed');
  const file = new File([blob], filename, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

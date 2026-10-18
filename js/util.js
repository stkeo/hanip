// DOM 도우미 — 사용자 글은 전부 textContent로만 넣는다(innerHTML 금지).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24px 선 아이콘 (자체 제작 — 다른 앱 아이콘을 쓰지 않는다)
export const ICONS = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M9 3v4M15 3v4',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  people: 'M10 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM20 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM1.5 20v-2a5 5 0 0 1 10 0v2ZM12.5 20v-2a5 5 0 0 1 10 0v2Z',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6',
  chat: 'M21 11a9 8 0 0 1-9 8c-1.4 0-2.7-.3-4-.8L3 21l1.4-5A7.5 7.5 0 0 1 3 11a9 8 0 0 1 18 0Z',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 6 0 0 1 16 0v2Z',
  gear: 'm9 3-.6 2.4-2 .9L4 5.6 2 9l1.8 1.7v2.6L2 15l2 3.4 2.4-.7 2 .9L9 21h6l.6-2.4 2-.9 2.4.7 2-3.4-1.8-1.7v-2.6L22 9l-2-3.4-2.4.7-2-.9L15 3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6M12 7h.01',
  send: 'M12 21V4M5 11l7-7 7 7',
  'check-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12l3 3 5-6',
  flame: 'M13 2c1 6-5 6-3 11 2-1 3-3 3-5 4 3 6 6 5 9a7 7 0 0 1-13-1c-1-5 4-8 8-14Z',
  fork: 'M4 3v5a3 3 0 0 0 6 0V3M7 3v18M16 13V7c0-2 2-4 4-4v18M16 13h4',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 16l5-5 5 5 3-3 5 5M16 7h.01',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v4h16v-4',
  alert: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v6M12 17h.01',
  star: 'm12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.5 9.4l6.6-1Z',
};

const FILLED_ICONS = {
  people: ICONS.people, users: ICONS.people, person: ICONS.person, chat: ICONS.chat,
  search: 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM14 10a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM15 14l7 6-2 2-6-7Z',
  star: ICONS.star,
};

export function icon(name, size = 24, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ic');
  const path = document.createElementNS(SVG_NS, 'path');
  const solid = filled && FILLED_ICONS[name];
  path.setAttribute('d', solid || ICONS[name] || '');
  path.setAttribute('fill', solid ? 'currentColor' : 'none');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('stroke', solid ? 'none' : 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export function wordmark({ size = 30 } = {}) {
  const mark = document.createElementNS(SVG_NS, 'svg');
  mark.setAttribute('viewBox', '0 0 40 40');
  mark.setAttribute('width', size);
  mark.setAttribute('height', size);
  mark.setAttribute('aria-hidden', 'true');
  for (const r of [18, 14]) {
    const ring = document.createElementNS(SVG_NS, 'circle');
    for (const [key, value] of Object.entries({ cx: 20, cy: 20, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 })) ring.setAttribute(key, value);
    mark.append(ring);
  }
  return h('span', { class: 'wordmark', style: { fontSize: `${size}px` } }, '한입', mark);
}

let toastTimer = 0;
export function toast(msg, ms = 2200, { type } = {}) {
  const el = document.getElementById('toast');
  // 기존 호출 유지. 안내를 성공으로 오인하지 않도록 완료 문장만 체크한다.
  const status = type || (/못|실패|오류|error|unavailable|꽉 찼/i.test(String(msg)) ? 'error'
    : /했어요|됐어요|되었어요|저장했|올렸|지웠|들어왔|찾았|담았|보냈|완료/.test(String(msg)) ? 'success' : 'info');
  el.dataset.status = status;
  el.replaceChildren(icon(status === 'success' ? 'check-circle' : status === 'error' ? 'alert' : 'info', 20), h('span', {}, msg));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

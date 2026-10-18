// 한입 — 화면·라우팅. 저장소는 config.json 유무로 체험(store-demo) / 실제(store-supabase) 중 하나.
// v1.8: 공개 태그 숨김, 아이디 잠금, 받은 메시지까지 읽음, 월별 리포트 조회.
// v1.9: 익명 전체 통계 참여 설정과 전체 상위 백분위.
// v2.0: 경험 인증·그릇 수·리스트·시즌 도전. 새 store 함수는 지원할 때만 호출한다.
// v2.1: 공개 집계 기준 표시·평가자 최소 5명·기간 조회로 챌린지 이력 보존.
import { h, icon, wordmark, toast, copyText, timeLabel, groupBy } from './util.js?v=202610181942';
import {
  METRICS, REACTIONS, RANK_SORTS, ymd, addDays, dateLabel, monthOf, shiftMonth, monthLabel, fmt1, fmtPrice,
  parsePrice, normPlace, josa, detectMealCards, todayProgress, monthSummary, reactionSummary, pendingTags,
  placeRanking, wishlist, INVITE_STATUS, slotGrid, choiceLabel, CATEGORIES, suggestCategory, monthlyTaste, streak, titlesFor, pickPlace, byArea, parseYmd,
  bowlTier, challengeProgress, groupAlertSummary,
} from './logic.js?v=202610181942';
import { compressPhoto } from './image.js?v=202610181942';
import { REPORT_REASONS, contentHidden, visibleContent } from './moderation.js?v=202610181942';
import { drawMealCard, drawMonthCard, drawReportCard, shareCanvas } from './cards.js?v=202610181942';

const APP = '한입';
const FEATURES = { named: false }; // 4주 친구 모임 출시: 공개 층은 보존하고 진입만 끈다.
const LS_GROUP = 'hanip-current-group';
const LS_GROUP_SEEN = 'hanip-group-seen';
const FEED_DAYS = 45;
const RANK_DAYS = 365;

const state = {
  store: null,
  moderation: { blocked: [], reported: [] },
  groups: [],
  groupId: null,
  feeds: new Map(), // groupId → { since, posts, fetchedAt }
  feedLoads: new Map(),
  groupAlerts: new Map(),
  groupSeen: null,
  mine: null, // 내 글 캐시
  wants: null, // 가고 싶은 곳 캐시
  invites: null, // 같이 가자 초대 캐시
  invitesAt: 0,
};

let routeVersion = 0;
let routeCleanup = null;
let closeModal = null;
let modalCleanup = null;
let storeFactory = null;
let captchaSiteKey = ''; // config.json의 공개 사이트 키. 비어 있으면 가짜 가입 막기 확인을 띄우지 않는다.
let turnstileLoad = null;

// Cloudflare Turnstile은 키가 있을 때 시작 화면에서만 불러온다(처리방침에 적은 외부 요청).
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('captcha_unavailable')));
    script.onerror = () => {
      turnstileLoad = null;
      script.remove();
      reject(new Error('captcha_unavailable'));
    };
    document.head.append(script);
  });
  return turnstileLoad;
}
const supports = (...names) => names.every((name) => typeof state.store?.[name] === 'function');

const $view = document.getElementById('view');

// ---------------- 시작 ----------------

async function boot() {
  document.querySelector('.brand').replaceChildren(wordmark({ size: 30 }));
  // 개발용 체험 모드는 키 파일을 읽지 않고 바로 시작한다. 배포 주소에서는 무시한다.
  const forceDemo = ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).has('demo');
  let cfg = {};
  try {
    if (!forceDemo) {
      const res = await fetch('./config.json', { cache: 'no-store' });
      if (res.ok) cfg = await res.json();
    }
  } catch {
    /* 설정 파일이 없으면 체험 모드 */
  }
  try {
    if (!forceDemo && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      const { createSupabaseStore } = await import('./store-supabase.js?v=202610181942');
      captchaSiteKey = typeof cfg.captchaSiteKey === 'string' ? cfg.captchaSiteKey.trim() : '';
      storeFactory = (opts) => createSupabaseStore(cfg, opts);
      state.store = await storeFactory();
    } else {
      const { createDemoStore } = await import('./store-demo.js?v=202610181942');
      storeFactory = () => createDemoStore();
      state.store = await storeFactory();
    }
  } catch (e) {
    mount(h('section', { class: 'empty' }, h('h2', {}, '열지 못했어요'), h('p', {}, e.message || String(e)),
      h('button', { class: 'btn', onclick: () => location.reload() }, '다시 시도')));
    return;
  }
  document.getElementById('demoBanner').hidden = state.store.mode !== 'demo';
  await refreshGroups();
  window.addEventListener('hashchange', route);
  // 방 밖에서 도착한 메시지도 탭 배지에 반영한다.
  setInterval(() => {
    if (state.store.me() && document.visibilityState === 'visible') refreshUnread(true).catch(() => {});
  }, 15000);
  route();
}

async function refreshGroups() {
  state.groups = await state.store.listMyGroups();
  const saved = localStorage.getItem(LS_GROUP);
  const pick = state.groups.find((g) => g.id === (state.groupId || saved)) || state.groups[0] || null;
  state.groupId = pick?.id || null;
  refreshGroupPills();
}

function setGroup(id) {
  state.groupId = id;
  try {
    localStorage.setItem(LS_GROUP, id);
  } catch {
    /* 저장 못 해도 이번 방문엔 유지 */
  }
  refreshGroupPills();
}

function refreshGroupPills() {
  for (const pill of document.querySelectorAll('.group-pill')) pill.replaceWith(groupPill());
}

const currentGroup = () => state.groups.find((g) => g.id === state.groupId) || null;
const today = () => ymd(new Date());
const isMe = (uid) => uid === state.store.me();
const groupName = (gid) => state.groups.find((g) => g.id === gid)?.name || '';

function nickOf(groupId, uid) {
  const g = state.groups.find((x) => x.id === groupId);
  return g?.members.find((m) => m.userId === uid)?.nickname || '나간 친구';
}

function invalidate() {
  state.feeds.clear();
  state.feedLoads.clear();
  state.groupAlerts.clear();
  groupAlertVersion += 1;
  state.mine = null;
  state.wants = null;
  state.invites = null;
  state.invitesAt = 0;
}

async function feedOf(groupId, since = addDays(today(), -FEED_DAYS), maxAge = Infinity) {
  const cached = state.feeds.get(groupId);
  if (cached && cached.since <= since && Date.now() - cached.fetchedAt < maxAge) return refreshPhotos(cached.posts.filter((p) => p.eatenOn >= since));
  const pending = state.feedLoads.get(groupId);
  if (pending) {
    const posts = await pending.promise;
    if (pending.since <= since) return posts.filter((p) => p.eatenOn >= since);
    return feedOf(groupId, since, maxAge);
  }
  // 알림 갱신과 화면 진입이 겹쳐도 같은 피드를 두 번 요청하지 않는다.
  const request = { since };
  request.promise = state.store.groupFeed(groupId, request.since);
  state.feedLoads.set(groupId, request);
  try {
    const posts = await request.promise;
    if (state.feedLoads.get(groupId) === request) state.feeds.set(groupId, { since: request.since, posts, fetchedAt: Date.now() });
    return posts.filter((p) => p.eatenOn >= since);
  } finally {
    if (state.feedLoads.get(groupId) === request) state.feedLoads.delete(groupId);
  }
}

async function myPosts() {
  if (!state.mine) state.mine = await state.store.myPosts();
  return refreshPhotos(state.mine);
}

async function myWants() {
  if (!state.wants) state.wants = await state.store.myWants();
  return refreshPhotos(state.wants);
}

const refreshPhotos = (posts) => supports('photoUrls') ? state.store.photoUrls(posts) : posts;
async function originalPhotos(posts) {
  return (await refreshPhotos(posts)).map((p) => ({ ...p, photoUrl: p.originalPhotoUrl || p.photoUrl }));
}

// 초대는 화면을 옮길 때마다 30초 캐시로 새로 읽어 알림 점을 맞춘다(웹 푸시 전 임시 알림)
async function loadInvites(force = false) {
  if (!force && state.invites && Date.now() - state.invitesAt < 30000) return state.invites;
  state.invites = await state.store.listInvites();
  state.invitesAt = Date.now();
  return state.invites;
}

let unreadVersion = 0;
async function refreshUnread(refreshFeeds = false) {
  void refreshGroupAlerts(refreshFeeds);
  const version = ++unreadVersion;
  const n = await state.store.unreadTotal();
  if (version !== unreadVersion) return;
  const badge = document.getElementById('chatBadge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.setAttribute('aria-label', '안 읽은 메시지 ' + n + '개');
}

function loadGroupSeen() {
  if (!state.groupSeen) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_GROUP_SEEN)) || {}; } catch { /* 이 방문의 시각만 기억한다 */ }
    state.groupSeen = Object.assign(Object.create(null), typeof saved === 'object' && !Array.isArray(saved) ? saved : {});
  }
  return state.groupSeen;
}

function groupSeenAt(groupId) {
  loadGroupSeen();
  const saved = state.groupSeen[groupId];
  if (typeof saved === 'string' && Number.isFinite(Date.parse(saved))) return saved;
  // 처음 알게 된 모임의 기존 글은 새 글로 세지 않는다.
  markGroupSeen(groupId);
  return state.groupSeen[groupId];
}

function markGroupSeen(groupId) {
  loadGroupSeen();
  state.groupSeen[groupId] = new Date().toISOString();
  try { localStorage.setItem(LS_GROUP_SEEN, JSON.stringify(state.groupSeen)); } catch { /* 저장 실패는 알리지 않는다 */ }
  const summary = state.groupAlerts.get(groupId);
  if (summary) state.groupAlerts.set(groupId, { ...summary, newPosts: 0, total: summary.total - summary.newPosts });
  updateGroupAlertDisplays();
}

let groupAlertVersion = 0;
async function refreshGroupAlerts(refreshFeeds = false) {
  const version = ++groupAlertVersion;
  const groups = [...state.groups];
  try {
    for (const group of groups) groupSeenAt(group.id);
    const [threads, invites, mine] = await Promise.all([state.store.listThreads(), loadInvites(true), myPosts()]);
    const entries = await Promise.all(groups.map(async (group) => {
      try {
        // 일반 화면의 캐시를 공유하되, 알림은 15초마다 새 피드를 확인한다.
        const posts = await feedOf(group.id, undefined, refreshFeeds ? 0 : 15000);
        return [group.id, posts];
      } catch { return null; }
    }));
    if (version !== groupAlertVersion) return;
    // 다른 모임을 읽는 사이 피드를 열었을 수 있으므로 최신 읽음 시각으로 계산한다.
    const now = new Date().toISOString();
    state.groupAlerts = new Map(entries.filter(Boolean).map(([groupId, posts]) => [groupId,
      groupAlertSummary({ threads, invites, posts, myPosts: mine, me: state.store.me(), groupId,
        seenAt: groupSeenAt(groupId), now })]));
  } catch {
    if (version !== groupAlertVersion) return;
    state.groupAlerts.clear();
  }
  updateGroupAlertDisplays();
}

function updateGroupPillAlert(button, group) {
  const otherAlerts = state.groups.some((g) => g.id !== group?.id && state.groupAlerts.get(g.id)?.total > 0);
  button.querySelector('.group-pill-alert-dot').hidden = !otherAlerts;
  button.setAttribute('aria-label', (group ? `${group.name}, ${group.members.length}명, 모임 선택` : '모임 선택')
    + (otherAlerts ? ', 다른 모임에 새 소식 있음' : ''));
}

function updateGroupOptionAlert(row) {
  const summary = state.groupAlerts.get(row.dataset.groupId);
  const total = summary?.total || 0;
  const text = row.querySelector('.group-option-summary');
  text.textContent = summary ? [['새 글', summary.newPosts], ['별점 요청', summary.requests],
    ['메시지', summary.unread], ['초대', summary.invites]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`).join(' · ') : '';
  text.hidden = !total;
  const badge = row.querySelector('.group-alert-count');
  badge.textContent = total > 99 ? '99+' : String(total);
  badge.setAttribute('aria-label', `새 소식 ${total}개`);
  badge.hidden = !total;
  row.querySelector(':scope > .ic').toggleAttribute('hidden', total > 0);
  row.classList.toggle('has-alerts', total > 0);
}

function updateGroupAlertDisplays() {
  for (const button of document.querySelectorAll('.group-pill')) updateGroupPillAlert(button, currentGroup());
  for (const row of document.querySelectorAll('.group-option')) updateGroupOptionAlert(row);
}

function profileLink(groupId, userId) {
  return `#/u/${encodeURIComponent(groupId)}/${encodeURIComponent(userId)}`;
}

function nickLink(groupId, userId, nickname = nickOf(groupId, userId)) {
  const g = state.groups.find((x) => x.id === groupId);
  return g?.members.some((m) => m.userId === userId)
    ? h('a', { class: 'nick-link', href: profileLink(groupId, userId) }, nickname)
    : h('b', {}, nickname);
}

function postLink(groupId, p) {
  return `#/p/${groupId}/${p.id}`;
}

function placeLink(groupId, place) {
  return `#/place/${groupId}/${encodeURIComponent(normPlace(place))}`;
}

function recordLink({ place = '', area = '', date = '', withId = '' } = {}) {
  const q = new URLSearchParams();
  if (place) q.set('place', place);
  if (area) q.set('area', area);
  if (date) q.set('date', date);
  if (withId) q.set('with', withId);
  const s = q.toString();
  return `#/post${s ? `?${s}` : ''}`;
}

// ---------------- 라우팅 ----------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query) };
}

function go(path) {
  const target = `#/${path}`;
  if (location.hash === target) route();
  else location.hash = target;
}

async function route() {
  routeVersion += 1;
  const version = routeVersion;
  routeCleanup?.();
  routeCleanup = null;
  closeModal?.();
  const { parts, params } = parseHash();
  const name = parts[0] || 'feed';
  if (!FEATURES.named && ['named', 'n'].includes(name)) {
    location.replace('#/rank');
    return;
  }
  document.body.dataset.screen = name;
  document.body.dataset.chrome = FOCUS_ROUTES.has(name) ? 'focus' : 'tab';
  setTopRight();
  setTab(name);
  window.scrollTo(0, 0);
  if (state.store.me()) refreshUnread().catch(() => { /* 다음 화면에서 다시 읽는다 */ });
  try {
    if (!state.store.me()) return renderStart({ mode: params.get('mode') || 'create', code: name === 'join' ? parts[1] || '' : '' });
    if (name === 'join') return renderStart({ mode: 'join', code: parts[1] || '' });
    if (name === 'start') return renderStart({ mode: params.get('mode') || 'create' });
    if (!state.groups.length && !['me', 'records', 'post', 'named', 'n', 'lists', 'l', 'report', 'month', 'chats', 'invites', 'settings'].includes(name)) return renderStart({ mode: 'create' });
    await refreshModeration();
    if (version !== routeVersion) return;
    switch (name) {
      case 'feed': return await renderFeed();
      case 'post': return await renderPost(params);
      case 'p': return await renderPostDetail(parts[1], parts[2]);
      case 'me': return params.has('filter') ? await renderRecords(params.get('filter')) : await renderMe();
      case 'records': return await renderRecords(params.get('filter') || 'all');
      case 'rank': return await renderRank(params.get('sort') || 'recommend', params.get('area') || '');
      case 'named': return await renderNamed(params.get('sort') || 'followers', params.get('following') === '1');
      case 'n': return await renderNamedProfile(parts[1]);
      case 'lists': return await renderLists(params.get('scope') || 'mine');
      case 'l': return await renderList(parts[1]);
      case 'members': return await renderMembers();
      case 'u': return await renderProfile(parts[1], parts[2]);
      case 'chats': return await renderChats();
      case 't': return await renderThread(parts[1]);
      case 'report': return await renderReport(params.get('ym') || monthOf(today()));
      case 'place': return await renderPlace(parts[1], parts[2]);
      case 'month': return await renderMonth(params.get('ym') || monthOf(today()), params.get('scope') || 'group');
      case 'group': return go('settings');
      case 'settings': return await renderGroup();
      case 'meal': return await renderMeal(parts[1], parts[2], parts[3]);
      case 'invites': return await renderInvites();
      default: return go('feed');
    }
  } catch (e) {
    if (version !== routeVersion) return;
    console.error(e);
    mount(h('section', { class: 'empty' }, h('h2', {}, '불러오지 못했어요'), h('p', {}, e.message || String(e)),
      h('button', { class: 'btn', onclick: () => route() }, '다시 시도')));
  }
}

const TAB_OF = { meal: 'feed', p: 'feed', place: 'rank', month: 'rank', named: 'rank', n: 'rank', lists: 'rank', l: 'rank', u: 'me', t: 'chats', records: 'me', report: 'me', settings: 'me', invites: 'me', members: 'me', start: 'me', join: 'me' };
const FOCUS_ROUTES = new Set(['post', 'p', 'meal', 't', 'report', 'start', 'join', 'month', 'place', 'u', 'n', 'l', 'members', 'invites', 'settings']);
const FOCUS_TITLES = { post: '한 끼 올리기', p: '먹은 기록', meal: '같이 먹은 기록', t: '채팅', report: '나의 리포트', start: '한입 시작하기', join: '모임 들어가기', month: '이달 결산', place: '가게 상세', u: '친구의 식탁', n: '네임드', l: '리스트', members: '모임 친구', invites: '같이 가자', settings: '설정' };
const TAB_ICONS = { feed: 'people', rank: 'search', post: 'plus', chats: 'chat', me: 'person' };

function setTab(name) {
  const tab = TAB_OF[name] || name;
  for (const a of document.querySelectorAll('#tabbar a')) {
    const active = a.dataset.tab === tab;
    a.classList.toggle('on', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.querySelector('svg')?.replaceWith(icon(TAB_ICONS[a.dataset.tab], a.dataset.tab === 'post' ? 30 : 24, { filled: active }));
  }
}

function mount(...nodes) {
  // replaceChildren은 null을 'null' 글자로 넣는다 → 빈 자리는 걸러낸다
  $view.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  // 화면별 전환 작업 중에도 로딩·실패·직접 진입에서 나갈 길을 유지한다.
  if (document.body.dataset.chrome === 'focus' && !$view.querySelector('.screen-header, .back-button')) {
    const name = document.body.dataset.screen;
    $view.prepend(screenHeader({ back: ['start', 'join'].includes(name) ? 'me' : (TAB_OF[name] || 'feed'),
      close: name === 'post', title: FOCUS_TITLES[name] || APP }));
  }
  if (document.body.dataset.chrome === 'tab' && ['feed', 'rank', 'chats'].includes(document.body.dataset.screen)
      && currentGroup() && !$view.querySelector('.group-pill')) $view.prepend(groupPill());
}

const loading = () => h('div', { class: 'loading' }, h('span', { class: 'dot' }), h('span', { class: 'dot' }), h('span', { class: 'dot' }));

function backButton(fallback = 'feed') {
  if (document.body.dataset.chrome === 'focus') return screenHeader({ back: fallback, title: FOCUS_TITLES[document.body.dataset.screen] || APP });
  return h('button', {
    class: 'btn ghost back-button',
    onclick: () => (history.length > 1 ? history.back() : go(fallback)),
  }, icon('back', 18), ' 뒤로');
}

// ---------------- 공통 조각 ----------------

export function scoreChips(p, compact = false) {
  return h('div', { class: `scores${compact ? ' compact' : ''}` },
    METRICS.map((m) => h('span', { class: 'score' }, h('i', {}, m.label),
      h('span', { class: 'score-value' }, icon('star', compact ? 15 : 20, { filled: true }), h('b', {}, fmt1(p[m.key]))))));
}

export function scoreInline(label, value) {
  return h('span', { class: 'score-inline' }, icon('star', 16, { filled: true }), h('span', {}, label), h('b', {}, fmt1(value)));
}

// size를 안 주면 CSS 기본(88px·화면별 덮어쓰기)을 따른다.
export function plate(text, { size } = {}) {
  const letter = Array.from(String(text || '').trim())[0] || '?';
  return h('span', { class: 'plate', role: 'img', 'aria-label': `${text || '기록'} 사진 없음`,
    style: size ? { '--plate-size': `${size}px` } : null }, h('span', { class: 'plate-letter', 'aria-hidden': 'true' }, letter));
}

export function photoEl(p, cls = 'photo', { original = false } = {}) {
  if (p.posts) {
    const shown = visibleItems('post', p.posts).find((post) => post.photoUrl);
    p = { ...p, photoUrl: shown?.photoUrl || null, originalPhotoUrl: shown?.originalPhotoUrl || null };
  } else if (p.userId && hiddenContent('post', p)) {
    p = { ...p, photoUrl: null, originalPhotoUrl: null };
  }
  const fallback = () => h('div', { class: `${cls} nophoto` }, plate(p.place));
  const full = p.originalPhotoUrl || p.posts?.find((post) => post.photoUrl === p.photoUrl)?.originalPhotoUrl;
  const src = original ? full || p.photoUrl : p.photoUrl;
  if (!src) return fallback();
  let triedOriginal = original || src === full;
  return h('img', { class: cls, src, alt: p.place || '식사 사진', loading: 'lazy', decoding: 'async',
    onerror: (event) => {
      if (!triedOriginal && full) { triedOriginal = true; event.currentTarget.src = full; }
      else event.currentTarget.replaceWith(fallback());
    } });
}

export function avatar(name, { size = 32 } = {}) {
  return h('span', { class: 'avatar', role: 'img', 'aria-label': String(name || '친구'),
    style: { width: `${size}px`, height: `${size}px` } }, Array.from(String(name || '').trim())[0] || '?');
}

export function avatarStack(names, { max = 4 } = {}) {
  return h('span', { class: 'avatar-stack', 'aria-label': names.join(', ') },
    names.slice(0, Math.max(0, max)).map((name) => avatar(name)));
}

export function groupPill() {
  const g = currentGroup();
  const button = h('button', { type: 'button', class: 'group-pill', disabled: !g, 'aria-haspopup': 'dialog',
    'aria-label': g ? `${g.name}, ${g.members.length}명, 모임 선택` : '모임 선택' },
    avatarStack((g?.members || []).map((m) => m.nickname)),
    h('span', { class: 'group-pill-name' }, g?.name || '모임'),
    h('span', { class: 'group-pill-chevron' }, icon('chevron-down', 18),
      h('span', { class: 'group-pill-alert-dot', hidden: true, 'aria-hidden': 'true' })),
    h('span', { class: 'group-pill-count' }, String(g?.members.length || 0)));
  updateGroupPillAlert(button, g);
  button.addEventListener('click', () => {
    const list = h('div', { class: 'group-options' }, state.groups.map((group) => h('button', {
      class: 'group-option', type: 'button', 'aria-current': group.id === state.groupId ? 'true' : null,
      dataset: { groupId: group.id },
      onclick: () => { closeModal?.(); setGroup(group.id); go('feed'); },
    }, avatarStack(group.members.map((m) => m.nickname), { max: 3 }),
    h('span', { class: 'group-option-name' }, group.name, h('small', {}, `${group.members.length}명`)),
    group.id === state.groupId ? icon('check-circle') : icon('chevron-right'),
    h('span', { class: 'group-option-summary', hidden: true }),
    h('span', { class: 'group-alert-count', hidden: true }))));
    for (const row of list.children) updateGroupOptionAlert(row);
    openModal(h('h3', {}, '모임 고르기'), list,
      h('a', { class: 'btn ghost wide', href: '#/start?mode=create' }, icon('plus', 20), '새 모임 만들기'),
      h('a', { class: 'btn ghost wide', href: '#/start?mode=join' }, '초대 코드로 들어가기'));
    void refreshGroupAlerts();
  });
  return button;
}

// back/close: true, fallback 경로 문자열 또는 콜백. close가 있으면 X가 우선한다.
export function screenHeader({ back = false, close = false, title = '', right = null } = {}) {
  const action = close || back;
  const fallback = typeof action === 'string' ? action : typeof back === 'string' ? back : 'feed';
  const leave = typeof action === 'function' ? action : () => (history.length > 1 ? history.back() : go(fallback));
  return h('header', { class: 'screen-header' },
    action ? h('button', { type: 'button', class: 'icon-btn back-button', 'aria-label': close ? '닫기' : '뒤로', onclick: leave }, icon(close ? 'close' : 'back')) : h('span'),
    h('h2', { class: 'screen-header-title' }, title), h('div', { class: 'screen-header-right' }, right));
}

// 상단바 오른쪽 자리(내 아바타·설정 톱니·"최근 1년" 등). 화면을 옮길 때마다 route()가 비운다.
export function setTopRight(...nodes) {
  document.getElementById('topRight')?.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
}

export function pageTitle(text, sub) {
  return h('div', { class: 'page-heading' }, h('h1', { class: 'page-title' }, text), sub ? h('p', { class: 'sub-line' }, sub) : null);
}

function menuLine(p) {
  const parts = [p.menu, p.price != null ? `1인 ${fmtPrice(p.price)}` : ''].filter(Boolean);
  return parts.length ? h('div', { class: 'post-menu' }, parts.join(' · ')) : null;
}

const categoryLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label || '기타';
const categoryTag = (key) => key ? h('span', { class: 'category-tag' }, categoryLabel(key)) : null;

function postVerification(p) {
  if (!p.verified) return null;
  const label = p.verifiedBy?.includes('receipt') ? '영수증 인증'
    : p.verifiedBy?.includes('photo') ? '사진 인증' : '경험 인증';
  return h('span', { class: 'post-verified' }, icon('check', 14), label);
}

function progressBar(value, label) {
  return h('progress', { class: 'count-progress', value: Math.max(0, Math.min(1, value)), max: 1, 'aria-label': label });
}

async function bowlsSection(userId, compact = false) {
  const own = isMe(userId) && !compact;
  if (!supports(own ? 'myBowls' : 'userBowls')) return null;
  try {
    // 인증 많은 종류가 위로(가장 자랑할 만한 그릇부터)
    const rows = (own ? await state.store.myBowls() : await state.store.userBowls(userId))
      .slice().sort((a, b) => b.verified - a.verified || b.total - a.total);
    if (compact) return h('div', { class: 'named-bowls' }, rows.filter((r) => r.verified > 0).map((r) => {
      const tier = bowlTier(r.verified);
      return h('p', {}, `${categoryLabel(r.category)} ${r.verified}그릇 인증${tier.label ? ` · ${tier.label}` : ''}`);
    }));
    return h('section', { class: 'card bowls-section' }, h('h2', {}, '그릇 수'),
      !isMe(userId) ? h('p', { class: 'sub-line' }, '공개 기록 기준이에요') : null,
      rows.length ? rows.map((r) => {
        const tier = bowlTier(r.verified);
        return h('div', { class: 'bowl-row' },
          h('div', { class: 'count-head' }, h('b', {}, categoryLabel(r.category)), tier.label ? h('span', { class: 'badge' }, tier.label) : null),
          h('p', {}, `인증 ${r.verified}그릇 · 전체 ${r.total}그릇`),
          progressBar(tier.progress, `${categoryLabel(r.category)} ${tier.next ? `다음 단계 ${tier.next.label}` : '장인 달성'}`),
          h('small', {}, tier.next ? `${tier.next.label}까지 ${tier.next.min - r.verified}그릇 남았어요` : '장인에 도달했어요'));
      }) : h('p', { class: 'sub-line' }, '첫 그릇을 기록해 보세요'));
  } catch { return h('p', { class: 'hint' }, '그릇 수를 불러오지 못했어요'); }
}

function representativeCategory(posts) {
  return CATEGORIES.map((c) => ({ ...c, count: posts.filter((p) =>
    (p.category || suggestCategory(`${p.place || ''} ${p.menu || ''}`)) === c.key).length }))
    .sort((a, b) => b.count - a.count)[0]?.key || 'etc';
}

async function expertCard(place, category) {
  if (!supports('expertRating')) return null;
  try {
    const rating = await state.store.expertRating(place, category, 50);
    if (!rating || rating.raters < 5 || rating.minBowls !== 50) return null;
    return h('section', { class: 'card expert-card' },
      h('h2', {}, `${categoryLabel(category)} ${rating.minBowls}그릇 넘게 먹은 사람들 평균`),
      h('p', { class: 'sub-line' }, rating.demo ? `체험용 예시 통계 · ${rating.raters}명` : `공개 인증 그릇 기준 · ${rating.raters}명`),
      h('div', { class: 'expert-scores' }, METRICS.map((m) => h('div', {},
        h('b', {}, fmt1(rating[m.key])), h('span', {}, m.label)))));
  } catch { return h('p', { class: 'hint' }, '경험 평점을 불러오지 못했어요'); }
}

function challengeCards(challenges, compact = false) {
  const ordered = [...challenges].sort((a, b) => Number(a.complete) - Number(b.complete) || b.progress - a.progress);
  if (compact) {
    const c = ordered[0];
    return c ? h('a', { class: 'card challenge-mini', href: '#/me' },
      h('span', {}, h('b', {}, c.title), ` ${Math.min(c.count, c.target)}/${c.target}`),
      c.complete ? h('span', { class: 'badge' }, '완료') : icon('chevR', 18),
      progressBar(c.progress, `${c.title} ${c.count}/${c.target}`)) : null;
  }
  return h('section', { class: 'card challenges-section' }, h('h2', {}, '도전 중'),
    ordered.map((c) => h('div', { class: 'challenge-row' },
      h('div', { class: 'count-head' }, h('b', {}, c.title),
        c.complete ? h('span', { class: 'badge' }, '완료') : h('small', {}, `${c.count}/${c.target}`)),
      h('p', {}, `${c.start.slice(5).replace('-', '/')}부터 ${c.end.slice(5).replace('-', '/')}까지${c.scope === 'group' ? ' · 이 모임 기록' : ''}`),
      progressBar(c.progress, `${c.title} ${c.count}/${c.target}`),
      h('small', {}, c.complete ? `${c.count}${c.unit} 달성했어요` : `${c.target - c.count}${c.unit} 남았어요`))));
}

async function personalChallenges() {
  if (!supports('myPostsInRange')) return [];
  const date = today();
  // 새 동네 판정에는 이번 달 이전의 모든 방문이 필요하다. 미래는 조회에서 제외한다.
  const posts = await state.store.myPostsInRange('0001-01-01', addDays(date, 1));
  return challengeProgress(posts, state.store.me(), date).filter((c) => c.scope === 'user');
}

function groupChallenges(posts, groupId) {
  return challengeProgress(posts.map((p) => ({ ...p, groupId })), state.store.me(), today())
    .filter((c) => c.scope === 'group').map((c) => ({ ...c, groupId }));
}

function withLine(p, groupId) {
  // 여러 모임에 올린 글이면 태그한 친구 중 이 모임 사람만 보여 준다
  const members = new Set(state.groups.find((g) => g.id === groupId)?.members.map((m) => m.userId) || []);
  const ids = (p.withUserIds || []).filter((u) => u !== p.userId && members.has(u));
  if (!groupId || !ids.length) return null;
  return h('div', { class: 'with' }, ids.map((u, i) => [i ? ', ' : '', nickLink(groupId, u)]), '랑 같이');
}

// 프로필 목적지가 같은 아바타·이름·날짜를 한 터치 영역으로 묶는다.
function personLink(who, face, detail = '') {
  const name = who.textContent;
  who.classList.add('person-link');
  face.setAttribute('aria-hidden', 'true');
  who.replaceChildren(face, h('span', { class: 'person-copy' },
    h('span', { class: 'person-name' }, name), detail ? h('small', {}, detail) : null));
  return who;
}

function postCard(p, { groupId = null, showDate = false, groupNames = null, publicProfile = null, publicOnly = false } = {}) {
  if (hiddenContent('post', p)) return null;
  const mine = isMe(p.userId) && !publicOnly;
  const menu = mine
    ? h('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => confirmDelete(p) }, icon('trash', 18))
    : postMenu(p, groupId);
  const shareBadge = groupNames
    ? h('span', { class: `badge${groupNames.length ? '' : ' private'}` },
      groupNames.length ? groupNames.join(', ') : p.isPublic ? '공개 기록' : [icon('lock', 13), '나만 보기'])
    : null;
  const placeText = [h('span', { class: 'place-name' }, p.place), p.area ? h('span', { class: 'area' }, p.area) : null];
  const title = groupId
    ? h('a', { class: 'post-place', href: postLink(groupId, p) }, ...placeText)
    : h('div', { class: 'post-place' }, ...placeText);
  // 사진이 있으면 4:3 사진, 없으면 작은 첫 글자 접시 + 가게 이름 한 줄
  const photo = p.photoUrl
    ? (groupId ? h('a', { href: postLink(groupId, p), class: 'photo-link post-photo-link', 'aria-label': `${p.place} 자세히` }, photoEl(p, 'post-photo')) : photoEl(p, 'post-photo'))
    : null;
  const placeRow = photo ? title : h('div', { class: 'post-plate-row' }, plate(p.place, { size: 48 }), title);
  const who = publicOnly ? (publicProfile ? h('a', { class: 'nick-link', href: namedLink(publicProfile.handle) }, p.nickname) : h('b', {}, p.nickname))
    : nickLink(groupId || p.groupIds?.find((id) => state.groups.some((g) => g.id === id)) || state.groupId, p.userId, p.nickname);
  return h('article', { class: 'post post-card' },
    h('div', { class: 'post-head' },
      personLink(who, avatar(p.nickname, { size: 40 }),
        showDate ? dateLabel(p.eatenOn, today()) : relTime(p.createdAt, p.eatenOn)),
      menu),
    p.note ? h('p', { class: 'note' }, p.note) : null,
    photo,
    h('div', { class: 'post-body' },
      placeRow,
      h('div', { class: 'post-tags' }, categoryTag(p.category), postVerification(p)),
      menuLine(p),
      scoreChips(p, false),
      withLine(p, groupId),
      shareBadge),
    groupId ? socialBlock(p, groupId) : null);
}

// "방금"·"12분 전"·"3시간 전", 하루가 넘으면 먹은 날짜
function relTime(iso, eatenOn) {
  const t = Date.parse(iso || '');
  const diff = Date.now() - t;
  if (!Number.isFinite(t) || diff < 0 || diff >= 24 * 3600e3) return eatenOn ? dateLabel(eatenOn, today()) : timeLabel(iso);
  if (diff < 60e3) return '방금';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  return `${Math.floor(diff / 3600e3)}시간 전`;
}

async function confirmDelete(p) {
  if (!confirm(`'${p.place}' 기록을 지울까요? 모임에서도 사라져요.`)) return;
  try {
    await state.store.deletePost(p);
    invalidate();
    toast('지웠어요');
    route();
  } catch (e) {
    toast(e.message);
  }
}

// ---------------- 반응·댓글 ----------------

function socialBlock(p, groupId, { full = false } = {}) {
  const wrap = h('div', { class: `social${full ? ' full' : ''}` });
  const draw = () => {
    const sum = reactionSummary(p.reactions, state.store.me());
    const kinds = REACTIONS.filter((r) => !(r.kind === 'want' && isMe(p.userId))); // 내 글에 '나도 갈래'는 없음
    const bar = h('div', { class: 'reacts' },
      kinds.map((r) => {
        const s = sum[r.kind];
        return h('button', {
          type: 'button', class: `react${s.mine ? ' on' : ''}`, title: r.label, 'aria-pressed': String(s.mine),
          'aria-label': `${r.label}${s.count ? ` ${s.count}명` : ''}`,
          onclick: () => react(p, groupId, r.kind, draw),
        }, h('span', { class: 'emo' }, r.emoji), s.count ? h('b', {}, s.count) : null);
      }),
      full ? null : h('a', {
        class: 'react cmt', href: postLink(groupId, p), 'aria-label': `댓글 ${p.comments?.length || 0}개`,
      }, h('span', { class: 'emo' }, '💬'), p.comments?.length ? h('b', {}, p.comments.length) : null));
    const who = full
      ? h('div', { class: 'react-who' }, kinds.filter((r) => sum[r.kind].count).map((r) =>
        h('span', {}, r.emoji, ' ', sum[r.kind].userIds.map((u, i) => [i ? ', ' : '', nickLink(groupId, u)]))))
      : null;
    wrap.replaceChildren(...[bar, who, full ? null : commentPreview(p, groupId)].filter(Boolean));
  };
  draw();
  return wrap;
}

// 같은 글에 반응 요청이 겹치면(연타) 서버·화면이 어긋난다 → 글 단위로 한 번에 하나만
const reactionBusy = new Set();

async function react(p, groupId, kind, redraw) {
  const key = `${groupId}:${p.id}`;
  if (reactionBusy.has(key)) return;
  reactionBusy.add(key);
  try {
    await reactOnce(p, groupId, kind, redraw);
  } finally {
    reactionBusy.delete(key);
  }
}

async function reactOnce(p, groupId, kind, redraw) {
  const me = state.store.me();
  const before = p.reactions || [];
  const had = before.some((x) => x.userId === me && x.kind === kind);
  p.reactions = had ? before.filter((x) => !(x.userId === me && x.kind === kind)) : [...before, { userId: me, kind }];
  redraw();
  try {
    const { on } = await state.store.toggleReaction(groupId, p.id, kind);
    if (on === had) {
      // 서버와 어긋나면 서버 쪽에 맞춘다
      p.reactions = on ? [...before.filter((x) => !(x.userId === me && x.kind === kind)), { userId: me, kind }]
        : before.filter((x) => !(x.userId === me && x.kind === kind));
      redraw();
    }
    if (kind === 'want') {
      state.wants = null;
      if (on) toast('가고 싶은 곳에 담았어요');
    }
  } catch (e) {
    p.reactions = before;
    redraw();
    toast(e.message);
  }
}

function commentPreview(p, groupId) {
  const list = visibleItems('comment', p.comments || []);
  if (!list.length) return null;
  return h('div', { class: 'cmts' },
    list.slice(-2).map((c) => h('p', {}, nickLink(groupId, c.userId), ' ', c.body)),
    list.length > 2 ? h('a', { href: postLink(groupId, p) }, `댓글 ${list.length}개 보기`) : null);
}

function inviteText(g) {
  const url = `${location.origin}${location.pathname}#/join/${g.code}`;
  return `${g.name} 밥 기록방 들어와\n코드 ${g.code}\n${url}`;
}

function openModal(...content) {
  closeModal?.();
  const $m = document.getElementById('modal');
  const previousFocus = document.activeElement;
  const background = [...document.querySelectorAll('.topbar, #demoBanner, #view, #tabbar')];
  const inertBefore = background.map((el) => el.inert);
  background.forEach((el) => { el.inert = true; });
  document.body.classList.add('modal-open');
  const close = () => {
    modalCleanup?.();
    modalCleanup = null;
    closeModal = null;
    $m.hidden = true;
    $m.replaceChildren();
    document.body.classList.remove('modal-open');
    background.forEach((el, i) => { el.inert = inertBefore[i]; });
    document.removeEventListener('keydown', onKey);
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...$m.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter((el) => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  document.addEventListener('keydown', onKey);
  $m.replaceChildren(
    h('div', { class: 'modal-backdrop', onclick: close }),
    h('div', { class: 'modal-sheet', role: 'dialog', 'aria-modal': 'true' },
      h('span', { class: 'modal-handle', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': '닫기', onclick: close }, icon('close')), ...content));
  const heading = $m.querySelector('h2, h3');
  if (heading) { heading.id = 'modalTitle'; $m.querySelector('[role="dialog"]').setAttribute('aria-labelledby', heading.id); }
  else $m.querySelector('[role="dialog"]').setAttribute('aria-label', '선택');
  $m.hidden = false;
  closeModal = close;
  $m.querySelector('.modal-close').focus();
  return close;
}

async function showCard(canvas, filename, title) {
  const img = h('img', { class: 'card-preview', src: canvas.toDataURL('image/jpeg', 0.85), alt: title });
  const btn = h('button', { class: 'btn primary wide' }, icon('share', 18), ' 저장·공유하기');
  btn.addEventListener('click', async () => {
    try {
      const r = await shareCanvas(canvas, filename, title);
      if (r === 'downloaded') toast('이미지를 저장했어요');
    } catch {
      toast('이미지를 만들지 못했어요');
    }
  });
  openModal(h('h3', {}, title), img, btn);
}

// ---------------- 신고와 표시 범위 ----------------

async function refreshModeration() {
  const store = state.store;
  const [blocked, reported] = await Promise.all([
    supports('listChatBlocked') ? store.listChatBlocked() : [],
    supports('listReportedTargets') ? store.listReportedTargets() : [],
  ]);
  if (state.store === store) state.moderation = { blocked, reported };
}
const hiddenContent = (type, item) => contentHidden(type, item, state.moderation);
const visibleItems = (type, items) => visibleContent(type, items, state.moderation);

function reportSheet(target) {
  const version = routeVersion;
  const reason = h('select', { name: 'reason', required: true, 'aria-label': '신고 사유' },
    h('option', { value: '' }, '사유를 골라 주세요'),
    REPORT_REASONS.map((text) => h('option', { value: text }, text)));
  const memo = h('textarea', { name: 'memo', maxlength: 200, rows: 3, 'aria-label': '신고 메모',
    placeholder: '덧붙일 내용을 적어 주세요' });
  const count = h('small', {}, '0/200');
  memo.addEventListener('input', () => { count.textContent = [...memo.value].length + '/200'; });
  const submit = h('button', { type: 'submit', class: 'btn primary wide', disabled: true }, '신고 보내기');
  let busy = false;
  reason.addEventListener('change', () => { submit.disabled = busy || !reason.value; });
  const form = h('form', { class: 'form report-form' },
    h('label', {}, '신고 사유', reason), h('label', {}, '메모 선택', memo, count), submit);
  const close = openModal(h('h3', {}, '신고하기'),
    h('p', { class: 'hint' }, '신고하면 내 화면에서 숨겨져요. 되돌릴 수 없어요.'), form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !reason.value) return;
    busy = true;
    submit.disabled = reason.disabled = memo.disabled = true;
    let received = false;
    try {
      await state.store.reportContent({ ...target, reason: reason.value, memo: memo.value });
      received = true;
      toast('신고했어요. 확인 후 조치할게요.');
    } catch (error) {
      received = /report_duplicate/.test(error.raw || '');
      toast(error.message);
    }
    if (received) {
      if (!state.moderation.reported.some((r) => r.targetType === target.targetType && r.targetId === target.targetId)) {
        state.moderation.reported.push({ targetType: target.targetType, targetId: target.targetId });
      }
      if (closeModal === close) close();
      if (version === routeVersion) route();
    } else {
      busy = false;
      submit.disabled = reason.disabled = memo.disabled = false;
    }
  });
}

function moderationMenu(target, { member = false } = {}) {
  if (isMe(target.targetUser) || !supports('reportContent')) return null;
  return h('button', { type: 'button', class: 'icon-btn moderation-more',
    'aria-label': ({ post: '글', comment: '댓글', message: '메시지', member: '멤버' })[target.targetType] + ' 더보기',
    'aria-haspopup': 'dialog', onclick: () => {
      const blocked = state.moderation.blocked.some((b) => b.userId === target.targetUser);
      openModal(h('h3', {}, '더보기'),
        h('button', { type: 'button', class: 'btn wide', onclick: () => reportSheet(target) }, '신고하기'),
        member && supports('blockChatUser', 'unblockChatUser') ? [
          h('p', { class: 'hint' }, '차단하면 이 친구의 글과 댓글, 채팅 메시지가 내 화면에서 숨겨져요. 상대에게 알리지 않아요.'),
          h('button', { type: 'button', class: 'btn wide', onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              if (blocked) await state.store.unblockChatUser(target.targetUser);
              else await state.store.blockChatUser(target.targetUser);
              invalidate();
              closeModal?.();
              toast(blocked ? '차단을 풀었어요' : '이 친구를 차단했어요');
              route();
            } catch (error) { toast(error.message); button.disabled = false; }
          } }, blocked ? '차단 풀기' : '차단하기'),
        ] : null);
    } }, '⋯');
}
const postMenu = (p, groupId) => groupId ? moderationMenu({
  groupId, targetType: 'post', targetId: p.id, targetUser: p.userId,
}) : null;

// ---------------- 시작(모임 만들기·들어가기) ----------------

function renderStart({ mode = 'create', code = '' }) {
  document.body.dataset.chrome = 'focus';
  document.body.dataset.screen = mode === 'join' ? 'join' : 'start';
  setTab('me');
  const isDemo = state.store.mode === 'demo';
  const form = (kind) => {
    const f = h('form', { class: 'form start-form', autocomplete: 'off' });
    const fields = kind === 'create'
      ? [h('label', {}, '모임 이름', h('input', { name: 'name', maxlength: 30, placeholder: '예: 내 밥 일기, 동기 밥모임', required: true }))]
      : [h('label', {}, '초대 코드', h('input', { name: 'code', maxlength: 8, value: code, placeholder: '6자리', required: true, autocapitalize: 'characters', class: 'start-code' }))];
    fields.push(
      h('label', {}, '닉네임', h('input', { name: 'nickname', maxlength: 12, placeholder: '예: 민지', required: true })),
      h('label', {}, '기록 찾기 번호 4자리',
        h('input', { name: 'pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]{4}', maxlength: 4, placeholder: '••••',
          autocomplete: 'off', required: true, class: 'start-pin' }),
        h('small', {}, '폰이나 브라우저가 바뀌면 초대 코드와 이 번호로 기록을 찾아요.')));
    const age = h('input', { type: 'checkbox', name: 'age14', required: true });
    const terms = h('input', { type: 'checkbox', name: 'terms', required: true, 'aria-label': '이용 규칙에 동의해요' });
    const submit = h('button', { class: 'btn primary wide', type: 'submit', disabled: true }, kind === 'create' ? '모임 만들기' : '들어가기');
    let busy = false;
    // 아직 계정이 없을 때만 사람 확인 토큰이 필요하다. 토큰은 한 번 쓰면 끝이다.
    const captchaNeeded = () => !isDemo && !!captchaSiteKey && !state.store.me();
    let captchaToken = '';
    let widgetId = null;
    const captchaBox = captchaNeeded() ? h('div', { class: 'start-captcha' }) : null;
    const resetCaptcha = () => {
      captchaToken = '';
      if (widgetId != null) { try { window.turnstile?.reset(widgetId); } catch { /* 다시 그리지 못하면 새로고침 안내 */ } }
    };
    const updateConsent = () => {
      submit.disabled = busy || !age.checked || !terms.checked || (captchaNeeded() && !captchaToken);
    };
    age.addEventListener('change', updateConsent);
    terms.addEventListener('change', updateConsent);
    if (captchaBox) {
      loadTurnstile().then((turnstile) => {
        if (!captchaBox.isConnected) return;
        widgetId = turnstile.render(captchaBox, {
          sitekey: captchaSiteKey, theme: 'auto', size: 'flexible', language: 'ko',
          callback: (token) => { captchaToken = token; updateConsent(); },
          'expired-callback': () => { captchaToken = ''; updateConsent(); },
          'error-callback': () => { captchaToken = ''; updateConsent(); },
        });
      }).catch(() => {
        captchaBox.replaceChildren(h('p', { class: 'hint' }, '사람 확인을 불러오지 못했어요. 새로고침해 주세요.'));
      });
    }
    f.append(...fields,
      h('label', { class: 'start-age' }, age, h('span', {}, '만 14세 이상이에요')),
      h('label', { class: 'start-age' }, terms, h('span', {}, h('a', { href: 'terms.html' }, '이용 규칙'), '에 동의해요')),
      h('p', { class: 'hint privacy-consent' }, '들어가기 전에 ', h('a', { href: 'privacy.html' }, '개인정보 처리방침'), '을 확인해 주세요. 만 14세 미만은 쓸 수 없어요.'),
      ...(captchaBox ? [captchaBox] : []), // DOM append는 null을 'null' 글자로 찍는다
      submit);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      if (!age.checked) return toast('만 14세 이상인지 확인해 주세요');
      if (!terms.checked) return toast('이용 규칙에 동의해 주세요');
      const d = Object.fromEntries(new FormData(f));
      if (!/^[0-9]{4}$/.test(d.pin || '')) return toast('번호는 숫자 4자리예요');
      if (captchaNeeded() && !captchaToken) return toast('사람인지 확인해 주세요');
      busy = true;
      submit.disabled = true;
      try {
        if (!state.store.me() && storeFactory) {
          const token = captchaNeeded() ? captchaToken : '';
          if (token) captchaToken = '';
          try {
            state.store = await storeFactory(token ? { captchaToken: token } : undefined);
          } catch (e) {
            if (token) resetCaptcha();
            throw e;
          }
          if (captchaBox && state.store.me()) captchaBox.hidden = true;
        }
        const g = kind === 'create'
          ? await state.store.createGroup(d.name, d.nickname, d.pin)
          : await state.store.joinGroup(d.code, d.nickname, d.pin);
        invalidate();
        await refreshGroups();
        setGroup(g.id);
        toast(g.status === 'reclaimed' ? '기록을 찾았어요' : g.status === 'already' ? '이미 들어와 있어요' : '들어왔어요');
        go('feed');
      } catch (e) {
        toast(e.message === 'demo_join_unavailable' ? '체험 모드에선 새 모임에 들어갈 수 없어요' : e.message, 3200);
      } finally {
        busy = false;
        updateConsent();
      }
    });
    return f;
  };

  const create = mode === 'create';
  const tabs = h('div', { class: 'seg start-seg', role: 'group', 'aria-label': '시작 방법' },
    h('button', { type: 'button', class: create ? 'on' : '', 'aria-pressed': String(create), onclick: () => go('start?mode=create') }, '새 모임 만들기'),
    h('button', { type: 'button', class: create ? '' : 'on', 'aria-pressed': String(!create), onclick: () => go('start?mode=join') }, '초대 코드로 들어가기'));
  // 이 화면은 자동 머리줄 대신 워드마크 줄을 머리줄로 쓴다. 모임이 있으면 오른쪽에 닫기.
  const head = h('header', { class: 'screen-header start-head' }, wordmark({ size: 34 }),
    state.groups.length ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': '내 모임으로', onclick: () => go('feed') }, icon('close')) : h('span'));

  mount(h('div', { class: 'scr-start' },
    head,
    h('h1', { class: 'start-title' }, h('span', {}, '같이 먹고,'), ' ', h('span', {}, '가볍게 남겨요.')),
    h('img', { class: 'start-hero', src: 'img/start-hero.jpg', alt: '', decoding: 'async',
      onerror: (event) => { event.currentTarget.remove(); } }),
    tabs,
    form(create ? 'create' : 'join'),
    isDemo ? h('p', { class: 'hint' }, '체험 모드라 예시 모임이 들어 있어요.') : null,
    state.groups.length ? h('button', { class: 'btn ghost wide back-home', onclick: () => go('feed') }, icon('back', 18), ' 내 모임으로') : null,
  ));
}

// ---------------- 모임 피드 ----------------

async function renderFeed() {
  const version = routeVersion;
  const g = currentGroup();
  if (!g) return renderStart({ mode: 'create' });
  mount(loading());
  const posts = await feedOf(g.id, undefined, 15000);
  let mine = null;
  try {
    mine = await myPosts();
  } catch {
    /* 태그 카드만 부정확해진다 */
  }
  const t = today();
  const prog = todayProgress(g.members, posts, t);
  const meals = detectMealCards(posts);
  const byDate = groupBy(posts, (p) => p.eatenOn);
  const tags = visibleItems('post', pendingTags(posts, mine || [], state.store.me()));

  let appts = [];
  try {
    appts = (await loadInvites()).filter((v) => v.groupId === g.id && v.status === 'yes'
      && (!/^\d{4}-/.test(pickedChoice(v)?.key || '') || pickedChoice(v).key.slice(0, 10) >= t));
  } catch {
    /* 약속 카드만 빠진다 */
  }
  let polls = [];
  let pollError = false;
  if (supports('listPolls')) {
    try { polls = await state.store.listPolls(g.id); } catch { pollError = true; }
  }
  const activePolls = polls.filter((p) => !pollEnded(p));
  let chatHref = '#/chats';
  if ((activePolls.length || pollError) && supports('listThreads')) {
    try {
      const room = (await state.store.listThreads()).find((room) => room.kind === 'group' && room.groupId === g.id);
      if (room) chatHref = threadLink(room.id);
    } catch {
      /* 방을 못 찾으면 채팅 목록에서 모임을 고른다. */
    }
  }
  if (version !== routeVersion) return;

  // 상단바 오른쪽: 내 아바타(내 식탁으로)
  const myNick = g.members.find((m) => isMe(m.userId))?.nickname || '나';
  setTopRight(h('a', { class: 'top-avatar', href: '#/me', 'aria-label': '내 식탁' }, avatar(myNick, { size: 40 })));

  const now = new Date();
  const heading = posts.length
    ? pageTitle('오늘도, 잘 먹었다.', `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`)
    : null;
  const notices = [];
  const chip = (label, href) => h('a', { class: 'pill feed-notice', href }, label, icon('chevR', 16));
  if (activePolls.length) notices.push(chip(`진행 중 투표 ${activePolls.length}`, chatHref));
  else if (pollError) notices.push(chip('투표 확인하기', chatHref));
  if (appts.length) notices.push(chip(`다가오는 약속 ${appts.length}`, '#/invites'));
  if (new Date().getDate() <= 7) {
    const reportMonth = shiftMonth(monthOf(t), -1);
    if (mine?.some((p) => monthOf(p.eatenOn) === reportMonth)) notices.push(
      chip(`${monthLabel(reportMonth)} 리포트`, `#/report?ym=${reportMonth}`));
  }
  const nodes = [groupPill(), heading];
  if (!posts.length) {
    nodes.push(h('section', { class: 'feed-empty' },
      h('h1', { class: 'page-title' }, '우리의 첫 한입을 남겨볼까요?'),
      h('img', { class: 'feed-empty-art', src: 'img/empty-plates.jpg', alt: '', 'aria-hidden': 'true', decoding: 'async' }),
      h('p', {}, '혼자 먼저 써도 돼요. 친구는 언제든 부를 수 있어요.'),
      h('a', { class: 'btn primary wide', href: '#/post' }, icon('plus', 20), '첫 한입 올리기'),
      h('button', { type: 'button', class: 'btn wide', onclick: () => go('settings') }, icon('people', 20), '친구 부르기')));
  }
  if (posts.length) nodes.push(feedStatus(prog, tags, g.id));
  if (notices.length) nodes.push(h('nav', { class: 'feed-notices', 'aria-label': '모임 알림' }, notices));
  // 오늘을 포함한 7일. 나머지는 이미 불러온 45일 범위에서만 펼친다.
  const since = addDays(t, -6);
  const dates = [...byDate].sort(([a], [b]) => b.localeCompare(a));
  const recent = dates.filter(([date]) => date >= since && date <= t);
  const earlier = dates.filter(([date]) => date < since || date > t);
  const dayNodes = ([date, list]) => feedDateNodes(g, date, list, meals.filter((m) => m.eatenOn === date), t);
  nodes.push(...recent.flatMap(dayNodes));
  if (posts.length && !recent.length) nodes.push(h('p', { class: 'hint feed-recent-empty' }, '최근 7일은 아직 기록이 없어요. 지난 기록을 펼쳐 보세요.'));
  if (earlier.length) {
    const history = h('div', { id: 'feed-history', hidden: true });
    let shown = 0;
    const count = h('p', { class: 'hint feed-history-count', role: 'status' });
    const next = h('button', { type: 'button', class: 'btn wide feed-history-next' }, '이전 기록 더 보기');
    const appendDates = () => {
      const batch = earlier.slice(shown, shown + 3);
      history.append(...batch.flatMap(dayNodes));
      shown += batch.length;
      count.textContent = `지난 기록 ${shown}/${earlier.length}일 확인 · 최근 ${FEED_DAYS}일 범위`;
      next.hidden = shown >= earlier.length;
      next.textContent = `이전 기록 더 보기 · ${earlier.length - shown}일 남음`;
    };
    next.addEventListener('click', () => {
      const previous = history.lastElementChild;
      appendDates();
      // 새로 펼친 날짜로 초점을 이어 마지막 버튼이 사라져도 위치를 잃지 않는다.
      const heading = previous?.nextElementSibling;
      if (heading) { heading.tabIndex = -1; heading.focus(); }
    });
    const more = h('button', { type: 'button', class: 'btn wide feed-history-toggle',
      'aria-expanded': 'false', 'aria-controls': 'feed-history', onclick: () => {
        if (!shown) appendDates();
        history.hidden = !history.hidden;
        count.hidden = history.hidden;
        next.hidden = history.hidden || shown >= earlier.length;
        more.setAttribute('aria-expanded', String(!history.hidden));
        more.textContent = history.hidden ? '지난 기록 보기' : '지난 기록 접기';
      } }, '지난 기록 보기');
    count.hidden = true;
    next.hidden = true;
    nodes.push(more, history, count, next);
  }
  mount(h('div', { class: 'scr-feed' }, nodes.filter(Boolean)));
  markGroupSeen(g.id);
}

function feedDateNodes(group, date, posts, meals, todayDate) {
  const inMeal = new Set(meals.flatMap((m) => m.posts.map((p) => p.id)));
  return [h('h2', { class: 'day' }, dateLabel(date, todayDate), h('small', {}, `${posts.length}끼`)),
    ...meals.map((m) => mealBlock(group, m)),
    ...posts.filter((p) => !inMeal.has(p.id)).map((p) => postCard(p, { groupId: group.id }))].filter(Boolean);
}

function feedStatus(prog, tags, groupId) {
  const meDone = prog.members.find((m) => isMe(m.userId))?.done;
  const detail = h('div', { class: 'feed-status-detail', id: 'feed-status-detail', hidden: true },
    progressCard(prog, groupId), ...tags.map((p) => tagCard(p, groupId)));
  const toggle = h('button', { type: 'button', class: 'feed-status-toggle',
    'aria-expanded': 'false', 'aria-controls': 'feed-status-detail',
    'aria-label': `오늘 ${prog.total}명 중 ${prog.done}명 올렸어요${tags.length ? `, 별점 요청 ${tags.length}개` : ''}. 상세 보기`,
    onclick: () => {
      detail.hidden = !detail.hidden;
      toggle.setAttribute('aria-expanded', String(!detail.hidden));
      toggle.setAttribute('aria-label', `오늘 ${prog.total}명 중 ${prog.done}명 올렸어요${tags.length ? `, 별점 요청 ${tags.length}개` : ''}. 상세 ${detail.hidden ? '보기' : '접기'}`);
    } },
    h('span', { class: 'avatar-stack feed-status-avatars', 'aria-hidden': 'true' },
      prog.members.slice(0, 4).map((m) => h('span', { class: `avatar${m.done ? ' done' : ''}` },
        m.done ? icon('check', 14) : Array.from(m.nickname || '?')[0]))),
    h('span', { class: 'feed-status-copy' }, h('b', {}, `오늘 ${prog.done}/${prog.total}명`),
      tags.length ? h('span', { class: 'pill feed-tag-count' }, `별점 요청 ${tags.length}`) : null),
    icon('chevron-down', 14));
  return h('section', { class: 'feed-status', 'aria-label': '오늘 모임 현황' },
    h('div', { class: 'feed-status-bar' }, toggle,
      meDone ? null : h('a', { class: 'btn small primary feed-status-post', href: '#/post' }, '나도 올리기')),
    detail);
}

function progressCard(prog, groupId) {
  const title = prog.everyone
    ? '오늘 다 올렸어요'
    : `오늘 ${prog.done}/${prog.total}명 올렸어요`;
  return h('section', { class: `progress${prog.everyone ? ' all' : ''}` },
    h('div', { class: 'progress-top' }, h('b', {}, title)),
    h('ul', { class: 'who' },
      prog.members.map((m) => h('li', { class: m.done ? 'done' : '' },
        personLink(nickLink(groupId, m.userId, m.nickname),
          h('span', { class: 'avatar' }, m.done ? icon('check', 14) : m.nickname.slice(0, 1)))))));
}

function tagCard(p, groupId) {
  return h('section', { class: 'tag-card' },
    h('div', { class: 'tag-text' },
      h('b', {}, nickLink(groupId, p.userId, p.nickname), `${josa(p.nickname, '이', '가')} 같이 먹었대요`),
      h('span', {}, `${dateLabel(p.eatenOn, today())} · ${p.place}`),
      h('small', {}, '별점 남기면 같이 먹은 카드가 생겨요')),
    h('a', {
      class: 'btn small primary',
      href: recordLink({ place: p.place, area: p.area, date: p.eatenOn, withId: p.userId }),
    }, '별점 남기기'));
}

const mealPath = (groupId, m) => `meal/${groupId}/${m.eatenOn}/${encodeURIComponent(m.placeKey)}`;
const COUNT_WORD = ['', '혼자', '둘이', '셋이', '넷이', '다섯이'];
const mealKindLabel = (n) => `${COUNT_WORD[n] || `${n}명이`} 함께 먹은 한 끼`;
const mealNames = (names) => names.length > 2 ? `${names[0]} 외 ${names.length - 1}명` : names.join(' + ');

// 공동식사 카드: 사진은 위(1:1 두 장, 한 장이면 16:10), 사람·가게·점수·한 줄·댓글은 사진 아래 흰 패널.
// 사람별 점수·삭제·카드 저장은 같이 먹은 기록 화면(renderMeal)에서.
function mealBlock(g, m) {
  const total = m.posts.length;
  m = { ...m, posts: visibleItems('post', m.posts) };
  if (!m.posts.length) return null;
  const names = m.posts.map((p) => p.nickname);
  const withPhoto = m.posts.filter((p) => p.photoUrl);
  const shown = withPhoto.length === 1 ? withPhoto : (withPhoto.length ? withPhoto : m.posts).slice(0, 2);
  const extra = m.posts.length - shown.length;
  const href = `#/${mealPath(g.id, m)}`;
  const area = m.posts.find((p) => p.area)?.area || '';
  const note = m.posts.find((p) => p.note)?.note || '';
  const nCmt = m.posts.reduce((n, p) => n + (p.comments || []).length, 0);
  const photos = h('a', { class: `meal-photos n${shown.length}`, href, 'aria-label': `${m.place} 같이 먹은 기록 보기` },
    shown.map((p, i) => h('span', { class: 'meal-tile' }, photoEl(p, 'meal-photo'),
      extra > 0 && i === shown.length - 1 && shown.length > 1 ? h('span', { class: 'meal-more', 'aria-label': `사진 ${extra}장 더` }, `+${extra}`) : null)));
  return h('section', {
    class: 'meal meal-card',
    onclick: (e) => { if (!e.target.closest('a,button')) go(mealPath(g.id, m)); },
  },
  photos,
  h('div', { class: 'meal-panel' },
    h('div', { class: 'meal-who' },
      avatarStack(names, { max: 3 }),
      h('b', { class: 'meal-names' }, mealNames(names)),
      h('small', { class: 'meal-kind' }, mealKindLabel(total))),
    h('a', { class: 'meal-place', href: placeLink(g.id, m.place) }, h('span', { class: 'place-name' }, m.place)),
    area ? h('div', { class: 'meal-area' }, icon('pin', 16), area) : null,
    scoreChips(m.averages),
    note ? h('p', { class: 'meal-note' }, note) : null,
    h('a', { class: 'meal-cmt', href, 'aria-label': `댓글 ${nCmt}개, 같이 먹은 기록 보기` }, icon('chat', 22), `댓글 ${nCmt}`)));
}

// ---------------- 글 하나 크게 보기 + 댓글 ----------------

async function renderPostDetail(groupId, postId) {
  const version = routeVersion;
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return go('feed');
  mount(loading());
  let p = (await feedOf(g.id)).find((x) => x.id === postId);
  if (!p) p = (await feedOf(g.id, '0001-01-01')).find((x) => x.id === postId);
  if (version !== routeVersion) return;
  if (p && hiddenContent('post', p)) return mount(backButton('feed'), h('p', { class: 'empty' }, '숨긴 글이에요'));
  if (!p) {
    return mount(backButton(), h('section', { class: 'empty' }, h('p', {}, '지워진 글이에요')));
  }
  p.comments = p.comments || [];

  const count = h('span', { class: 'cmt-count' });
  const list = h('ul', { class: 'cmt-list' });
  const drawComments = () => {
    count.textContent = p.comments.length ? String(p.comments.length) : '';
    const visible = visibleItems('comment', p.comments);
    list.replaceChildren(...(visible.length
      ? visible.map((c) => {
        const nick = isMe(c.userId) ? '나' : nickOf(g.id, c.userId);
        return h('li', {},
          h('div', { class: 'cmt-body' },
            h('div', { class: 'cmt-who' },
              personLink(nickLink(g.id, c.userId), avatar(nick, { size: 36 })),
              h('small', {}, `${dateLabel(ymd(new Date(c.createdAt)), today())} ${timeLabel(c.createdAt)}`)),
            h('p', {}, c.body)),
          isMe(c.userId) ? h('button', {
            class: 'icon-btn', 'aria-label': '댓글 삭제',
            onclick: async () => {
              if (!confirm('이 댓글을 지울까요?')) return;
              try {
                await state.store.deleteComment(c.id);
                p.comments = p.comments.filter((x) => x.id !== c.id);
                drawComments();
              } catch (e) {
                toast(e.message);
              }
            },
          }, icon('trash', 18)) : moderationMenu({ groupId: g.id, targetType: 'comment', targetId: c.id, targetUser: c.userId }));
      })
      : [h('li', { class: 'none' }, '아직 댓글이 없어요')]));
  };
  drawComments();

  const input = h('input', { maxlength: 100, placeholder: '댓글 달기', enterkeyhint: 'send', 'aria-label': '댓글' });
  const send = h('button', { class: 'cmt-send', type: 'submit', 'aria-label': '보내기' }, icon('send', 20));
  const form = h('form', { class: 'cmt-form' }, input, send);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    try {
      const c = await state.store.addComment(g.id, p.id, body);
      p.comments = [...p.comments, c];
      input.value = '';
      drawComments();
    } catch (e) {
      toast(e.message);
    } finally {
      send.disabled = false;
    }
  });

  mount(h('div', { class: 'scr-detail' },
    screenHeader({ back: 'feed', title: p.place }),
    h('article', { class: 'detail' },
      photoEl(p, 'detail-photo', { original: true }),
      h('div', { class: 'detail-body' },
        h('div', { class: 'post-head' },
          personLink(nickLink(g.id, p.userId, p.nickname), avatar(p.nickname, { size: 40 }),
            `${dateLabel(p.eatenOn, today())} ${timeLabel(p.createdAt)}`),
          isMe(p.userId) ? h('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => confirmDelete(p) }, icon('trash', 20)) : postMenu(p, g.id)),
        h('a', { class: 'post-place big', href: placeLink(g.id, p.place) }, p.place, icon('chevron-right', 20)),
        p.area ? h('div', { class: 'meal-area' }, icon('pin', 16), p.area) : null,
        h('div', { class: 'post-tags' }, categoryTag(p.category), postVerification(p)),
        scoreChips(p),
        p.note ? h('p', { class: 'note' }, p.note) : null,
        menuLine(p),
        withLine(p, g.id),
        socialBlock(p, g.id, { full: true }),
        h('button', {
          class: 'btn wide invite-go', type: 'button',
          onclick: () => openInviteSheet({ groupId: g.id, place: p.place, area: p.area, postId: p.id, photoUrl: p.photoUrl }),
        }, icon('calendar', 18), ' 여기 같이 가자'))),
    h('section', { class: 'comments' }, h('h2', { class: 'section-title' }, '댓글 ', count), list, form)));
}

// ---------------- 올리기 ----------------

async function fileHash(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function verificationMessage(result) {
  if (result?.verified) return '올렸어요 · 경험 인증됐어요';
  const reasons = {
    duplicate_receipt: '이미 쓴 영수증이에요', duplicate_photo: '이미 쓴 사진이에요',
    daily_limit: '이 종류는 하루 2그릇까지 인증해요', mismatch: '인증 정보가 기록과 맞지 않아요',
    not_owner: '내 기록만 인증할 수 있어요',
  };
  return `기록은 저장했어요 · ${reasons[result?.reason] || '인증하지 못했어요'}`;
}

async function renderPost(params = new URLSearchParams()) {
  const version = routeVersion;
  const g = currentGroup();
  const t = today();
  const canVerify = supports('verifyPost');
  const demo = state.store.mode === 'demo';
  let photoVersion = 0, receiptVersion = 0, photoBusy = false, receiptBusy = false, saving = false, photoUrl = null;
  onRouteLeave(() => { photoVersion++; receiptVersion++; if (photoUrl) URL.revokeObjectURL(photoUrl); });
  const pre = {
    place: params.get('place') || '', area: params.get('area') || '',
    date: params.get('date') || '', withId: params.get('with') || '',
  };
  const form = {
    photoBlob: null, photoThumbBlob: null, place: pre.place, area: pre.area, note: '', eatenOn: t,
    category: suggestCategory(pre.place), categoryManual: false, isPublic: false,
    photoHash: null, receiptHash: null, photoName: '', aiCategory: null, aiConfidence: null,
    scores: { taste: 0, worth: 0, recommend: 0 },
    groupIds: new Set(state.groups.filter((x) => !pre.withId || x.members.some((m) => m.userId === pre.withId)).map((x) => x.id)),
    withUserIds: new Set(pre.withId ? [pre.withId] : []),
  };

  const dateChoices = [[t, '오늘'], [addDays(t, -1), '어제'], [addDays(t, -2), '그저께']];
  if (pre.date && pre.date <= t && pre.date >= addDays(t, -30)) {
    if (!dateChoices.some(([d]) => d === pre.date)) dateChoices.push([pre.date, dateLabel(pre.date, t)]);
    form.eatenOn = pre.date;
  }

  // 가게 이름 추천: 오늘·어제 이 모임에 올라온 가게 → 내 최근 가게
  const suggestions = [];
  try {
    const seen = new Set();
    const add = (p, why) => {
      const k = normPlace(p.place);
      if (seen.has(k)) return;
      seen.add(k);
      suggestions.push({ place: p.place, area: p.area, why });
    };
    if (g) visibleItems('post', await feedOf(g.id)).filter((p) => p.eatenOn >= addDays(t, -1) && !isMe(p.userId)).forEach((p) => add(p, `${p.nickname}도 감`));
    (await myPosts()).slice(0, 12).forEach((p) => add(p, '내가 간 곳'));
  } catch {
    /* 추천 없이 진행 */
  }

  const publicProfile = FEATURES.named ? await state.store.myPublicProfile() : null;
  if (version !== routeVersion) return;

  const errorLine = (text) => h('p', { class: 'post-field-error', hidden: true }, icon('alert', 18), h('span', {}, text));
  const selectChevron = () => h('span', { class: 'post-select-chev', 'aria-hidden': 'true' }, icon('chevron-down', 20));
  const field = (label, control, ...rest) => h('div', { class: 'post-field' },
    h('label', { class: 'post-label', for: control.id }, label), control, ...rest);

  // 사진(선택): 없으면 옅은 블루 행, 있으면 폭 가득 사진 + 흰 원형 카메라(바꾸기)
  const emptyShot = () => [h('span', { class: 'shot-ic' }, icon('camera', 28)), h('b', { class: 'shot-title' }, '사진 추가'),
    h('span', { class: 'shot-opt' }, '선택', icon('chevron-right', 18))];
  const preview = h('div', { class: 'shot' }, emptyShot());
  const shotCap = h('span', { class: 'post-label shot-cap', hidden: true }, '사진 · 선택');
  const photoError = h('p', { class: 'post-field-error post-photo-error', role: 'alert', hidden: true }, icon('alert', 20),
    h('span', {}, h('span', { class: 'err-line' }, '사진을 열지 못했어요.'), h('span', { class: 'err-line' }, '다른 사진을 고르거나 사진 없이 기록해 주세요.')));
  const file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'photoInput' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f || saving) return;
    const selected = ++photoVersion;
    photoBusy = true;
    form.photoHash = null;
    form.photoBlob = null;
    form.photoThumbBlob = null;
    form.photoName = '';
    photoError.hidden = true;
    drawEstimate();
    updateSubmit();
    preview.classList.add('busy');
    try {
      const { photoBlob: blob, photoThumbBlob } = await compressPhoto(f);
      let hash = null;
      if (canVerify) {
        try { hash = await fileHash(f); }
        catch { if (selected === photoVersion) toast('사진 인증을 준비하지 못했어요. 기록은 올릴 수 있어요'); }
      }
      if (selected !== photoVersion || version !== routeVersion) return;
      form.photoBlob = blob;
      form.photoThumbBlob = photoThumbBlob;
      form.photoHash = hash;
      form.photoName = f.name;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(blob);
      preview.replaceChildren(h('img', { src: photoUrl, alt: '올릴 사진' }),
        h('span', { class: 'retake' }, icon('camera', 22), h('span', { class: 'visually-hidden' }, '사진 바꾸기')));
      preview.classList.add('has');
      shotCap.hidden = false;
      drawEstimate();
    } catch {
      if (selected !== photoVersion || version !== routeVersion) return;
      preview.replaceChildren(...emptyShot());
      preview.classList.remove('has');
      shotCap.hidden = true;
      photoError.hidden = false;
    } finally {
      if (selected === photoVersion) { photoBusy = false; preview.classList.remove('busy'); updateSubmit(); }
    }
  });
  const shotLabel = h('label', { for: 'photoInput', class: 'shot-label' }, preview);

  const placeInput = h('input', { id: 'postPlace', name: 'place', maxlength: 40, placeholder: '어디서 먹었어요?', required: true, enterkeyhint: 'next', value: pre.place });
  const areaInput = h('input', { id: 'postArea', name: 'area', maxlength: 20, placeholder: '예: 성수동', value: pre.area });
  const placeError = errorLine('가게 이름을 적어 주세요');
  const categorySelect = h('select', { id: 'postCategory', name: 'category' }, CATEGORIES.map((c) => h('option', { value: c.key }, c.label)));
  categorySelect.addEventListener('change', () => { form.category = categorySelect.value; form.categoryManual = true; });
  const estimate = h('div', { class: 'ai-estimate', hidden: true });
  const drawEstimate = () => {
    estimate.hidden = !canVerify || !demo || !form.photoBlob;
    if (estimate.hidden) { form.aiCategory = null; form.aiConfidence = null; return; }
    form.aiCategory = suggestCategory(`${placeInput.value} ${menuInput.value} ${form.photoName}`);
    form.aiConfidence = form.aiCategory === 'etc' ? 0.65 : 0.92;
    estimate.replaceChildren(h('button', { class: 'chip', type: 'button', onclick: () => {
      form.category = form.aiCategory; form.categoryManual = true; drawCategories();
    } }, `AI 추정 · ${categoryLabel(form.aiCategory)} 같아요 · ${Math.round(form.aiConfidence * 100)}%`),
    h('p', { class: 'sub-line' }, '체험용 추정이에요. 누르면 종류가 바뀌어요'));
  };
  const receiptInput = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'visually-hidden', id: 'receiptInput' });
  const receiptStatus = h('p', { class: 'sub-line', role: 'status' });
  const drawReceipt = () => {
    receiptStatus.textContent = form.receiptHash
      ? `${demo ? '영수증 확인됐어요' : '영수증을 골랐어요'} · ${form.place.trim() || '가게를 적어 주세요'} · ${form.eatenOn}`
      : '영수증 원본은 저장하지 않아요';
    receiptRemove.hidden = !form.receiptHash;
  };
  const receiptRemove = h('button', { class: 'btn small', type: 'button', hidden: true, onclick: () => {
    receiptVersion++; form.receiptHash = null; receiptBusy = false; receiptInput.value = ''; drawReceipt(); updateSubmit();
  } }, '영수증 빼기');
  receiptInput.addEventListener('change', async () => {
    const f = receiptInput.files?.[0];
    if (!f || saving) return;
    const selected = ++receiptVersion;
    if (receiptBox) receiptBox.open = true;
    receiptBusy = true; form.receiptHash = null; receiptRemove.hidden = true; updateSubmit();
    receiptStatus.textContent = '영수증을 확인하고 있어요';
    try {
      const hash = await fileHash(f);
      if (selected !== receiptVersion || version !== routeVersion) return;
      form.receiptHash = hash;
      drawReceipt();
    } catch {
      if (selected === receiptVersion && version === routeVersion) receiptStatus.textContent = '영수증을 읽지 못했어요. 다시 골라 주세요';
    } finally {
      if (selected === receiptVersion) { receiptBusy = false; updateSubmit(); }
    }
  });
  // 경험 인증(영수증)은 접힌 행 — 영수증을 고르면 저절로 펼친다
  const receiptBox = canVerify ? h('details', { class: 'post-more post-receipt' },
    h('summary', {}, h('span', {}, '경험 인증 · 영수증'), icon('chevron-right', 20)),
    h('div', { class: 'post-more-body' }, receiptInput,
      h('div', { class: 'post-receipt-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => receiptInput.click() }, '영수증 인증'), receiptRemove),
      receiptStatus,
      h('p', { class: 'sub-line' }, demo ? '체험에선 적은 가게와 날짜로 확인해요' : '영수증 글자는 아직 읽지 않아요'),
      !demo ? h('p', { class: 'sub-line' }, '지금은 적은 가게와 날짜로 확인해요') : null)) : null;
  drawReceipt();
  const drawCategories = () => { categorySelect.value = form.category; };
  const autoCategory = () => {
    if (!form.categoryManual) { form.category = suggestCategory(`${placeInput.value} ${menuInput.value}`); drawCategories(); }
    drawEstimate(); drawReceipt();
  };
  placeInput.addEventListener('input', () => { form.place = placeInput.value; placeError.hidden = true; if (chips) chips.hidden = Boolean(placeInput.value.trim()); autoCategory(); });
  areaInput.addEventListener('input', () => { form.area = areaInput.value; });
  const chips = suggestions.length && !pre.place
    ? h('div', { class: 'chips post-suggest', role: 'group', 'aria-label': '최근 가게' }, suggestions.slice(0, 8).map((s) => h('button', {
      type: 'button', class: 'chip',
      onclick: () => {
        placeInput.value = s.place;
        form.place = s.place;
        placeError.hidden = true;
        chips.hidden = true;
        if (s.area) { areaInput.value = s.area; form.area = s.area; }
        autoCategory();
      },
    }, s.place, h('small', {}, s.why))))
    : null;

  // 별점: 윗줄 = 항목명 · n / 5, 아랫줄 = 큰 별 다섯 개(정수)
  const ratingRefs = {};
  const ratingRow = (m) => {
    const num = h('b', {}, '-');
    const err = errorLine(`${m.label} 별점을 눌러 주세요`);
    const btns = [1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', class: 'star', 'aria-label': `${m.label} ${n}점`, 'aria-pressed': 'false',
      onclick: () => {
        form.scores[m.key] = n;
        btns.forEach((b, i) => { b.classList.toggle('on', i < n); b.setAttribute('aria-pressed', String(i + 1 === n)); });
        num.textContent = String(n);
        err.hidden = true;
      },
    }, icon('star', 36, { filled: true })));
    ratingRefs[m.key] = { err, first: btns[0] };
    return h('div', { class: 'rating' }, h('span', { class: 'rating-label' }, m.label), h('div', { class: 'stars' }, btns),
      h('span', { class: 'rating-val' }, num, ' / 5'), err);
  };

  const dateSelect = h('select', { id: 'postDate', name: 'eatenOn' }, dateChoices.map(([d, label]) => h('option', { value: d }, label)));
  dateSelect.value = form.eatenOn;
  dateSelect.addEventListener('change', () => { form.eatenOn = dateSelect.value; drawReceipt(); });

  const note = h('textarea', { id: 'postNote', name: 'note', maxlength: 100, rows: 2, placeholder: '한 줄평을 남겨 주세요' });
  note.addEventListener('input', () => { form.note = note.value; });

  // 접힌 행: 메뉴 · 가격 · 같이 먹은 친구
  const menuInput = h('input', { id: 'postMenu', name: 'menu', maxlength: 30, placeholder: '예: 등심카츠' });
  menuInput.addEventListener('input', autoCategory);
  drawCategories();
  const priceInput = h('input', { id: 'postPrice', name: 'price', inputmode: 'numeric', maxlength: 9, placeholder: '숫자만' });
  const priceError = errorLine('가격은 숫자로만 적어 주세요');
  priceInput.addEventListener('input', () => { priceError.hidden = true; });
  const withBox = h('div', { class: 'chips' });
  const withField = h('div', { class: 'post-with' }, h('span', { class: 'post-label' }, '같이 먹은 친구'), withBox);
  // 태그는 "올리는 모든 모임에 다 있는 친구"만 — 다른 모임 사람 정보가 새지 않게(서버도 같은 규칙으로 막는다)
  const withPool = () => {
    const selected = state.groups.filter((x) => form.groupIds.has(x.id));
    const pool = new Map();
    for (const m of selected[0]?.members || []) {
      if (isMe(m.userId)) continue;
      if (selected.every((x) => x.members.some((y) => y.userId === m.userId))) pool.set(m.userId, m.nickname);
    }
    return pool;
  };
  const noFriendText = () => {
    const n = form.groupIds.size;
    if (!n) return '나만 보기일 땐 태그할 수 없어요';
    return n > 1 ? `${n === 2 ? '두' : `${n}개`} 모임에 모두 있는 친구가 없어요` : '이 모임엔 아직 친구가 없어요';
  };
  const renderWith = () => {
    withField.hidden = form.isPublic;
    if (form.isPublic) { form.withUserIds.clear(); withBox.replaceChildren(); return; }
    const pool = withPool();
    for (const uid of [...form.withUserIds]) if (!pool.has(uid)) form.withUserIds.delete(uid);
    withBox.replaceChildren(...(pool.size
      ? [...pool].map(([uid, nick]) => h('button', {
        type: 'button', class: `chip toggle${form.withUserIds.has(uid) ? ' on' : ''}`, 'aria-pressed': String(form.withUserIds.has(uid)),
        onclick: () => { form.withUserIds.has(uid) ? form.withUserIds.delete(uid) : form.withUserIds.add(uid); renderWith(); },
      }, form.withUserIds.has(uid) ? icon('check', 16) : null, nick))
      : [h('small', { class: 'muted' }, form.groupIds.size > 1 ? `${noFriendText()}. 고른 모임에 다 있는 친구만 돼요` : noFriendText())]));
  };
  const more = h('details', { class: 'post-more', open: Boolean(pre.withId) },
    h('summary', {}, h('span', {}, '메뉴 · 가격 · 같이 먹은 친구'), icon('chevron-right', 20)),
    h('div', { class: 'post-more-body' },
      h('div', { class: 'more-grid' }, field('메뉴', menuInput), field('1인 가격', priceInput)), priceError,
      withField));

  // 공유 범위 행(누르면 "어디에 올릴까요" 시트) + 맨 아래 주 버튼
  const submit = h('button', { class: 'btn primary wide big post-submit', type: 'submit' }, '올리기');
  const submitStatus = h('p', { class: 'post-submit-status', role: 'status', hidden: true });
  const busyLabel = (text) => [h('span', { class: 'post-spin', 'aria-hidden': 'true' }), text];
  const updateSubmit = () => {
    submit.disabled = saving || photoBusy || receiptBusy;
    submitStatus.textContent = saving ? '올리는 중이에요' : photoBusy ? '사진을 준비하고 있어요' : receiptBusy ? '영수증을 확인하고 있어요' : '';
    submitStatus.hidden = !submit.disabled;
    const label = !form.groupIds.size && !form.isPublic ? '나만 저장하기' : '올리기';
    if (submit.disabled) submit.replaceChildren(...busyLabel(label));
    else submit.textContent = label;
  };
  const shareRow = h('button', { type: 'button', class: 'post-share-row', 'aria-haspopup': 'dialog' });
  const drawShare = () => {
    const s = postScope(form);
    shareRow.classList.toggle('private', s.kind === 'private');
    shareRow.setAttribute('aria-label', `공유 범위: ${s.title}, ${s.sub}. 바꾸기`);
    shareRow.replaceChildren(h('span', { class: 'post-share-ic' }, icon(s.icon, 26)),
      h('span', { class: 'post-share-text' }, h('b', {}, s.title), h('small', {}, s.sub)), icon('chevron-right', 20));
  };
  const onScopeChange = () => { renderWith(); drawShare(); updateSubmit(); };
  shareRow.addEventListener('click', () => postScopeSheet({ form, publicProfile, onChange: onScopeChange, withPool, noFriendText }));
  onScopeChange();

  const submitError = h('div', { class: 'post-submit-error', role: 'alert', hidden: true });
  const fields = h('fieldset', { class: 'post-fields' },
    file, h('div', { class: 'post-photo' }, shotCap, shotLabel, photoError), estimate,
    field('가게 이름', placeInput, chips, placeError),
    field('동네', areaInput),
    h('div', { class: 'post-pair' }, field('종류', categorySelect, selectChevron()), field('날짜', dateSelect, selectChevron())),
    h('h2', { class: 'post-ask' }, '어땠어요?'),
    h('div', { class: 'post-ratings' }, METRICS.map(ratingRow)),
    field('한 마디', note),
    more, receiptBox, shareRow);
  const actions = h('div', { class: 'post-actions' }, submitError, submitStatus, submit);
  const el = h('form', { class: 'post-form scr-post', novalidate: true }, fields,
    h('div', { class: 'post-actions-slot' }, actions));
  // 입력 초점으로 키보드를 예상한다. 버튼으로 초점을 옮길 때는 클릭이 끝날 때까지 흐름 위치를 지킨다.
  const syncEditing = (target) => {
    const editing = target instanceof Element && fields.contains(target) && target.matches('input:not([type="file"]), textarea, select');
    const acting = target instanceof Element && actions.contains(target) && el.classList.contains('post-editing');
    el.classList.toggle('post-editing', editing || acting);
  };
  el.addEventListener('focusin', (ev) => syncEditing(ev.target));
  el.addEventListener('focusout', (ev) => syncEditing(ev.relatedTarget));
  const actionsSize = new ResizeObserver(() => {
    el.style.setProperty('--post-actions-height', `${actions.getBoundingClientRect().height}px`);
  });
  actionsSize.observe(actions);
  onRouteLeave(() => actionsSize.disconnect());

  const showError = (err, target) => {
    err.hidden = false;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  el.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saving || photoBusy || receiptBusy) return;
    if (!form.place.trim()) return showError(placeError, placeInput);
    const missing = METRICS.find((m) => !form.scores[m.key]);
    if (missing) return showError(ratingRefs[missing.key].err, ratingRefs[missing.key].first);
    const price = parsePrice(priceInput.value);
    if (priceInput.value.trim() && price == null) { more.open = true; return showError(priceError, priceInput); }
    saving = true;
    el.classList.remove('post-editing');
    submitError.hidden = true;
    fields.disabled = true;
    updateSubmit();
    try {
      const created = await state.store.createPost({
        photoBlob: form.photoBlob, photoThumbBlob: form.photoThumbBlob, place: form.place, area: form.area, note: form.note, eatenOn: form.eatenOn,
        ...form.scores, groupIds: [...form.groupIds],
        category: form.category, isPublic: FEATURES.named && form.isPublic,
        menu: menuInput.value.trim(), price, withUserIds: !form.isPublic && form.groupIds.size ? [...form.withUserIds] : [],
      });
      let message = form.groupIds.size || form.isPublic ? '올렸어요' : '나만 보게 저장했어요';
      if (canVerify && (form.photoHash || form.receiptHash)) {
        const proof = {
          ...(form.receiptHash ? { receiptHash: form.receiptHash, receiptStore: form.place.trim(), receiptDate: form.eatenOn } : {}),
          ...(form.photoHash ? { photoHash: form.photoHash } : {}),
          ...(demo && form.photoHash ? { aiCategory: form.aiCategory, aiConfidence: form.aiConfidence } : {}),
        };
        try { message = verificationMessage(await state.store.verifyPost(typeof created === 'string' ? created : created.id, proof)); }
        catch { message = '기록은 저장했어요 · 인증하지 못했어요'; }
      }
      invalidate();
      if (version !== routeVersion) return;
      // 저장 뒤 인증만 못 한 경우는 실패가 아니라 "저장 완료 + 인증 미완료" 안내
      toast(message, 3800, { type: message.startsWith('기록은 저장했어요') ? 'info' : 'success' });
      if (form.groupIds.size) {
        if (!form.groupIds.has(state.groupId)) setGroup([...form.groupIds][0]);
        go('feed');
      } else go('me');
    } catch (e) {
      if (version !== routeVersion) return;
      // 결과를 확인하지 못한 오류 — 완료/미완료를 단정하지 않고 입력이 남아 있다는 것만 알린다
      const reason = e?.message === 'demo_storage_full' ? '체험 모드 저장 공간이 꽉 찼어요' : e?.message;
      submitError.replaceChildren(icon('alert', 22), h('div', {},
        h('b', {}, '완료 여부를 확인하지 못했어요.'), ...(reason ? [h('p', {}, reason)] : []), h('p', {}, '입력한 내용은 이 화면에 남아 있어요.')));
      submitError.hidden = false;
      saving = false;
      fields.disabled = false;
      updateSubmit();
    }
  });

  mount(screenHeader({ close: 'feed', title: '한 끼 올리기' }), el);
}

// 올리기의 공유 범위 요약(모임 0개/공개 끔 = 나만 보기, 0개/켬 = 공개만, 1개+/끔 = 모임만, 1개+/켬 = 모임+공개)
function postScope(form) {
  const groups = state.groups.filter((x) => form.groupIds.has(x.id));
  const n = groups.length;
  if (!n && !form.isPublic) return { kind: 'private', icon: 'lock', title: '나만 보기', sub: '모임에는 보이지 않아요' };
  if (!n) return { kind: 'public', icon: 'globe', title: '전체 공개', sub: '모임에는 보이지 않고 공개 페이지에 보여요' };
  return { kind: 'group', icon: 'people', n, title: n === 1 ? groups[0].name : `${groups[0].name} 외 ${n - 1}곳`,
    sub: form.isPublic ? `모임 ${n}곳 + 전체 공개` : n === 1 ? '이 모임에만 보여요' : `모임 ${n}곳에만 보여요` };
}

// "어디에 올릴까요" 바텀시트 — 체크를 바꾸면 바로 작성값에 반영, 선택 완료·X는 창만 닫는다
function postScopeSheet({ form, publicProfile, onChange, withPool, noFriendText }) {
  const box = (input) => [input, h('span', { class: 'post-check', 'aria-hidden': 'true' }, icon('check', 18))];
  const checkbox = () => h('input', { type: 'checkbox', class: 'visually-hidden' });
  const privateInput = checkbox();
  const groupInputs = state.groups.map((x) => [x, checkbox()]);
  const publicInput = FEATURES.named && publicProfile ? checkbox() : null;
  const count = h('span', { class: 'post-scope-count' });
  const withBox = h('div', { class: 'post-scope-with' });
  const summary = h('div', { class: 'post-scope-summary' });
  const publicRow = publicInput ? h('label', { class: 'post-scope-opt post-scope-public' },
    h('span', { class: 'post-scope-ic' }, icon('globe', 24)),
    h('span', { class: 'post-scope-name' }, '네임드 페이지에도 올리기', h('small', {}, '모임 밖에서도 누구나 볼 수 있어요.')), box(publicInput)) : null;

  const sync = () => {
    privateInput.checked = !form.groupIds.size && !form.isPublic;
    for (const [x, input] of groupInputs) input.checked = form.groupIds.has(x.id);
    if (publicInput) { publicInput.checked = form.isPublic; publicRow.classList.toggle('on', form.isPublic); }
    count.textContent = `${form.groupIds.size}개 선택`;
    withBox.hidden = form.isPublic;
    if (!form.isPublic) {
      const pool = withPool();
      const tagged = [...form.withUserIds].map((uid) => pool.get(uid)).filter(Boolean);
      withBox.replaceChildren(h('b', {}, '같이 간 친구'),
        h('p', {}, !pool.size ? `${noFriendText()}.` : tagged.length ? `${tagged.join(', ')} 태그했어요.` : '메뉴 · 가격 · 같이 먹은 친구에서 고를 수 있어요.'),
        ...(form.groupIds.size ? [h('small', {}, '고른 모임에 다 있는 친구만 돼요.')] : []));
    }
    const s = postScope(form);
    const n = form.groupIds.size;
    summary.className = `post-scope-summary ${form.isPublic ? 'card-like' : 'line'}`;
    if (s.kind === 'private') summary.replaceChildren(icon('lock', 20), h('span', {}, '나만 보기 · 모임에는 보이지 않아요'));
    else if (s.kind === 'group' && !form.isPublic) summary.replaceChildren(icon('people', 22), h('span', {}, n === 1 ? '선택한 모임에만 보여요' : `선택한 모임 ${n}곳에만 보여요`));
    else summary.replaceChildren(h('span', { class: 'post-scope-summary-ic' }, icon('globe', 26), n ? icon('people', 26) : null),
      h('span', {}, h('b', {}, n ? `모임 ${n}곳 + 전체 공개` : '전체 공개'),
        h('small', {}, n ? '공개 페이지에도 이 기록이 보여요.' : '모임에는 보이지 않고 공개 페이지에 보여요.')));
  };
  const changed = () => { onChange(); sync(); };
  privateInput.addEventListener('change', () => {
    if (privateInput.checked) { form.groupIds.clear(); form.isPublic = false; }
    changed();
  });
  for (const [x, input] of groupInputs) input.addEventListener('change', () => { input.checked ? form.groupIds.add(x.id) : form.groupIds.delete(x.id); changed(); });
  publicInput?.addEventListener('change', () => { form.isPublic = publicInput.checked; changed(); });
  sync();

  openModal(h('div', { class: 'post-scope-sheet' },
    h('h3', {}, '어디에 올릴까요'),
    h('p', { class: 'post-scope-lead' }, '함께 볼 모임을 골라 주세요'),
    h('label', { class: 'post-scope-opt post-scope-private' }, h('span', { class: 'post-scope-ic' }, icon('lock', 22)),
      h('span', { class: 'post-scope-name' }, '나만 보기'), box(privateInput)),
    state.groups.length ? h('div', { class: 'post-scope-groups' },
      h('div', { class: 'post-scope-head' }, h('b', {}, '모임에 공유'), count),
      groupInputs.map(([x, input]) => h('label', { class: 'post-scope-opt' }, avatar(x.name, { size: 44 }),
        h('span', { class: 'post-scope-name' }, x.name), box(input)))) : null,
    publicRow, withBox, summary,
    h('button', { type: 'button', class: 'btn primary wide big', onclick: () => closeModal?.() }, '선택 완료')));
}

// ---------------- 내 기록 + 가고 싶은 곳 ----------------

const RECORD_FILTERS = [['all', '전체'], ['shared', '모임에 올린'], ['private', '나만 보기'], ['want', '가고 싶은 곳']];
const RECORD_LIST_TITLES = { all: '전체 기록', shared: '모임에 올린 기록', private: '나만 보는 기록' };

// '9월 24일'(오늘·어제는 그대로)
function shortDay(s) {
  const t = today();
  if (s === t) return '오늘';
  if (s === addDays(t, -1)) return '어제';
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 내 식탁 하위 화면 머리: 뒤로 화살표 + 큰 제목
function recordsHead(title, sub) {
  return h('div', { class: 'rec-head' },
    h('div', { class: 'rec-head-row' },
      h('button', { type: 'button', class: 'icon-btn rec-back', 'aria-label': '뒤로',
        onclick: () => (history.length > 1 ? history.back() : go('me')) }, icon('back', 26)),
      h('h1', { class: 'page-title' }, title)),
    sub ? h('p', { class: 'sub-line' }, sub) : null);
}

function streakLine(days) {
  return h('p', { class: `rec-streak${days ? '' : ' zero'}` }, icon('flame', 22),
    days ? h('b', {}, `${days}일 연속 기록 중`) : h('span', {}, '오늘 한 끼를 남기면 연속 기록이 시작돼요'));
}

function scopeLine(p, groupNames) {
  if (groupNames.length) {
    return h('p', { class: 'rec-scope' }, icon('people', 18), h('span', {}, groupNames.join(', ') + (p.isPublic ? ' · 공개' : '')));
  }
  return p.isPublic ? h('p', { class: 'rec-scope' }, icon('globe', 18), h('span', {}, '공개 기록'))
    : h('p', { class: 'rec-scope' }, icon('lock', 18), h('span', {}, '나만 보기'));
}

// 내 기록 카드(R15): 먹은 날·삭제 → 사진(없으면 작은 접시) → 가게·동네·종류·메뉴 → 세 점수 → 한줄평 → 공유 범위
function recordCard(p, groupNames = []) {
  const info = h('div', { class: 'rec-info' },
    h('h3', { class: 'rec-place' }, p.place),
    [p.area, p.category ? categoryLabel(p.category) : ''].some(Boolean)
      ? h('p', { class: 'rec-sub' }, [p.area, p.category ? categoryLabel(p.category) : ''].filter(Boolean).join(' · ')) : null,
    menuLine(p), postVerification(p));
  return h('article', { class: `record-card${p.photoUrl ? ' has-photo' : ''}` },
    h('div', { class: 'rec-top' },
      h('span', {}, `나 · ${dateLabel(p.eatenOn, today())}`),
      h('button', { type: 'button', class: 'rec-delete', onclick: () => confirmDelete(p) }, icon('trash', 20), '삭제')),
    p.photoUrl ? [photoEl(p, 'rec-photo'), info]
      : h('div', { class: 'rec-main' }, plate(p.place, { size: 76 }), info),
    scoreChips(p),
    p.note ? h('p', { class: 'rec-note' }, p.note) : null,
    scopeLine(p, groupNames));
}

function recordFilters(filter) {
  return h('div', { class: 'rec-filters', role: 'group', 'aria-label': '기록 필터' },
    RECORD_FILTERS.map(([k, label]) => h('button', {
      type: 'button', class: `rec-filter${filter === k ? ' on' : ''}`, 'aria-pressed': filter === k ? 'true' : 'false',
      onclick: () => go(`records?filter=${k}`),
    }, label)));
}

async function renderRecords(filter) {
  const version = routeVersion;
  mount(loading());
  const all = await myPosts();
  if (version !== routeVersion) return;
  if (!RECORD_FILTERS.some(([k]) => k === filter)) filter = 'all';
  const names = new Map(state.groups.map((g) => [g.id, g.name]));

  if (filter === 'want') {
    const want = await wantNodes(all);
    if (version !== routeVersion) return;
    return mount(h('div', { class: 'scr-records want-view' },
      recordsHead('가고 싶은 곳', '친구 글에서 담은 곳이에요.'), recordFilters(filter), ...want));
  }

  const ym = monthOf(today());
  const s = monthSummary(all, ym);
  const cell = (label, value) => h('div', {}, h('span', {}, label), h('b', {}, value));
  const list = all.filter((p) => filter === 'all' || (filter === 'private' ? !p.groupIds.length && !p.isPublic : p.groupIds.length));
  const nodes = [
    recordsHead('내 식탁'),
    h('section', { class: 'rec-summary', 'aria-label': `${monthLabel(ym)} 전체 기록` },
      h('div', { class: 'rec-summary-head' }, h('b', {}, `${monthLabel(ym)} 전체 기록`), h('small', {}, '필터와 관계없이 이번 달 기준')),
      h('div', { class: 'rec-summary-nums' },
        cell('기록', s.total), cell('간 곳', s.placeCount), cell('평균 추천', s.total ? fmt1(s.averages.recommend) : '-'))),
    streakLine(streak(all, state.store.me(), today())),
    recordFilters(filter),
    h('h2', { class: 'rec-list-title' }, RECORD_LIST_TITLES[filter], h('small', {}, `${list.length}개`)),
  ];
  if (!list.length) {
    nodes.push(h('section', { class: 'rec-empty' }, plate('한입', { size: 72 }),
      h('p', {}, filter === 'private' ? '나만 보는 기록이 없어요' : filter === 'shared' ? '모임에 올린 기록이 없어요' : '아직 기록이 없어요'),
      h('a', { class: 'btn primary', href: '#/post' }, '첫 기록 남기기')));
  }
  for (const p of list) nodes.push(recordCard(p, p.groupIds.map((id) => names.get(id)).filter(Boolean)));
  if (filter === 'private' && list.length) nodes.push(h('p', { class: 'hint' }, '이 기록은 나만 볼 수 있어요.'));
  mount(h('div', { class: 'scr-records' }, ...nodes));
}

async function wantNodes(mine) {
  const w = wishlist(await myWants(), mine);
  if (!w.todo.length && !w.done.length) {
    return [h('section', { class: 'rec-empty' }, plate('한입', { size: 72 }),
      h('p', {}, '친구 글에서 나도 갈래를 누르면 여기 모여요'))];
  }
  const remove = async (x) => {
    try {
      // 같은 가게를 여러 글·모임에서 담았으면 전부 뺀다(하나만 빼면 다른 게 다시 떠오른다)
      const targets = (await state.store.myWants()).filter((w) => normPlace(w.place) === x.placeKey);
      for (const t of targets) await state.store.removeWant(t.groupId, t.postId);
      invalidate();
      toast('뺐어요');
      route();
    } catch (e) {
      toast(e.message);
    }
  };
  const todoCard = (x) => h('article', { class: 'want-card' },
    x.photoUrl ? photoEl(x, 'want-photo') : h('div', { class: 'want-photo nophoto' }, plate(x.place, { size: 96 })),
    h('h3', { class: 'want-place' }, x.place, x.area ? h('span', { class: 'area' }, x.area) : null),
    h('p', { class: 'want-meta' }, `${groupName(x.groupId) || '모임'} · ${shortDay(ymd(new Date(x.createdAt)))} 담음`),
    h('div', { class: 'want-actions' },
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => openInviteSheet({ groupId: x.groupId, place: x.place, area: x.area, postId: x.postId, photoUrl: x.photoUrl }),
      }, '같이 가자'),
      h('a', { class: 'btn primary', href: recordLink({ place: x.place, area: x.area }) }, '다녀왔어요', icon('chevron-right', 18))),
    h('div', { class: 'want-remove' },
      h('button', { type: 'button', class: 'want-remove-btn', 'aria-label': `${x.place} 빼기`, onclick: () => remove(x) }, '빼기')));
  const doneRow = (x) => h('li', { class: 'want-done' }, icon('check-circle', 30),
    h('div', {}, h('b', {}, x.place), h('small', {}, `${shortDay(x.visitedOn)} 다녀옴`)));
  return [
    h('h2', { class: 'rec-list-title' }, '가고 싶은 곳', h('small', {}, String(w.todo.length))),
    w.todo.length ? w.todo.map(todoCard) : h('p', { class: 'hint' }, '남은 곳을 모두 다녀왔어요'),
    w.todo.length ? h('p', { class: 'want-help' }, '다녀왔어요를 누르면 기록을 작성해요.') : null,
    w.done.length ? h('h2', { class: 'rec-list-title done-title' }, '다녀온 곳', h('small', {}, String(w.done.length))) : null,
    w.done.length ? h('ul', { class: 'want-done-list' }, w.done.map(doneRow)) : null,
  ].flat().filter(Boolean);
}

// ---------------- 우리 모임 맛집 순위 ----------------

function tasteTabs(active) {
  return h('div', { class: 'seg taste-tabs' },
    h('button', { class: active === 'rank' ? 'on' : '', 'aria-current': active === 'rank' ? 'page' : null, onclick: () => go('rank') }, '우리 맛집'),
    FEATURES.named ? h('button', { class: active === 'named' ? 'on' : '', 'aria-current': active === 'named' ? 'page' : null, onclick: () => go('named') }, '네임드') : null,
    supports('listLists') ? h('button', { class: active === 'lists' ? 'on' : '', 'aria-current': active === 'lists' ? 'page' : null, onclick: () => go('lists') }, '리스트') : null,
    h('button', { class: active === 'month' ? 'on' : '', onclick: () => go('month') }, '이달 결산'));
}

// 정렬 이름은 드롭다운에서 읽히는 말로. 값(key)과 순서는 RANK_SORTS 그대로.
const RANK_SORT_TEXT = { recommend: '추천순', taste: '맛 좋은 순', worth: '가성비 순', count: '기록 많은 순' };
const rankSortText = (key) => RANK_SORT_TEXT[key] || RANK_SORTS.find((s) => s.key === key)?.label || key;
// 1위 카드 배지: 지금 정렬 기준에 대해 사실인 말만.
const RANK_BADGE = { recommend: '다시 가고 싶은 곳 1위', taste: '맛 1위', worth: '가성비 1위', count: '기록 가장 많은 곳' };

function rankPillSelect(label, value, options, onChange) {
  const select = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([key, text]) => h('option', { value: key, selected: key === value }, text)));
  return h('label', { class: 'rank-pill' }, select);
}

function rankScore(r, sort) {
  if (sort === 'count') return h('span', { class: 'score-inline rank-count' }, h('span', {}, '기록'), h('b', {}, `${r.count}번`));
  return scoreInline(METRICS.find((m) => m.key === sort)?.label || '추천', r[sort]);
}

async function renderRank(sort, area = '') {
  const version = routeVersion;
  const g = currentGroup();
  if (!g) return renderStart({ mode: 'create' });
  if (!RANK_SORTS.some((s) => s.key === sort)) sort = 'recommend';
  // 고정 조회 범위 표시(조작 아님) — RANK_DAYS = 365일
  setTopRight(h('span', { class: 'rank-range' }, '최근 1년'));
  const head = () => [pageTitle('우리 맛집'), tasteTabs('rank'), groupPill()];
  mount(...head(), loading());
  const posts = await feedOf(g.id, addDays(today(), -RANK_DAYS));
  const rows = placeRanking(posts, sort);
  let polls = [];
  let pollError = false;
  if (supports('listPolls')) {
    try { polls = await state.store.listPolls(g.id); } catch { pollError = true; }
  }
  if (version !== routeVersion) return;
  const areas = byArea(rows).slice(0, 8);
  if (!areas.some((x) => x.area === area)) area = '';
  const visible = area ? rows.filter((r) => r.area.trim() === area) : rows;
  const rankPath = (sortKey, areaName) => `rank?${new URLSearchParams({ sort: sortKey, area: areaName })}`;
  const placeHref = (r) => `#/place/${g.id}/${encodeURIComponent(r.placeKey)}`;

  const nodes = [...head()];
  if (rows.length) {
    nodes.push(h('div', { class: 'rank-filters' },
      rankPillSelect('정렬', sort, RANK_SORTS.map((s) => [s.key, rankSortText(s.key)]), (key) => go(rankPath(key, area))),
      rankPillSelect('동네', area, [['', '동네 전체'], ...areas.map((x) => [x.area, `${x.area} · ${x.count}곳`])], (name) => go(rankPath(sort, name))),
      h('span', { class: 'rank-total' }, `${visible.length}곳`)));
  } else {
    nodes.push(h('section', { class: 'empty rank-empty' }, plate('한입', { size: 96 }),
      h('p', {}, '기록이 더 쌓이면 순위가 생겨요'),
      h('a', { class: 'btn primary', href: '#/post' }, '첫 기록 남기기')));
  }

  const [top, ...rest] = visible;
  if (top) {
    const names = [...new Set(top.posts.map((p) => p.userId))].map((uid) => nickOf(g.id, uid) || '친구');
    nodes.push(h('a', { class: 'rank-hero', href: placeHref(top), 'aria-label': `1위 ${top.place}, 가게 상세 보기` },
      h('div', { class: 'rank-hero-media' }, photoEl(top, 'rank-hero-photo'),
        h('span', { class: 'rank-hero-badge' }, `${area ? `${area} ` : ''}${RANK_BADGE[sort]}`)),
      h('div', { class: 'rank-hero-body' },
        h('div', { class: 'rank-hero-top' },
          h('div', { class: 'rank-hero-name' }, h('b', {}, top.place),
            top.area ? h('span', { class: 'rank-where' }, icon('pin', 16), top.area) : null),
          h('div', { class: 'rank-hero-who' }, avatarStack(names, { max: 3 }), h('small', {}, `${top.visitors}명이 기록했어요`))),
        scoreChips(top))));
  }
  if (rest.length) {
    nodes.push(h('ol', { class: 'rank-list', start: 2 }, rest.map((r, i) => h('li', {},
      h('a', { class: 'rank-row', href: placeHref(r) },
        h('span', { class: 'rank-no', 'aria-label': `${i + 2}위` }, i + 2),
        photoEl(r, 'rank-thumb'),
        h('div', { class: 'rank-body' },
          h('b', {}, r.place),
          h('div', { class: 'rank-meta' },
            r.area ? h('span', { class: 'rank-where' }, icon('pin', 15), r.area) : null,
            rankScore(r, sort))),
        icon('chevron-right', 20))))));
  }

  nodes.push(h('section', { class: 'rank-tools' }, h('p', {}, '어디 갈지 고민될 때'), tasteActions(g)));
  if (polls.length) nodes.push(h('h2', { class: 'day' }, '모임 투표'), ...polls.map((p) => pollCard(p)));
  if (pollError) nodes.push(h('p', { class: 'hint' }, '투표를 불러오지 못했어요'));
  mount(...nodes);
}

// ---------------- 리스트 ----------------

const listLink = (id) => `#/l/${encodeURIComponent(id)}`;
const listScopeLabel = (list) => list.groupId ? groupName(list.groupId) || '모임' : list.isPublic ? '공개' : '나만';

function listShareText(list) {
  const places = list.items.map((item, i) => `${i + 1}. ${item.place}${item.area ? ` · ${item.area}` : ''}${item.note ? ` · ${item.note}` : ''}`).join('\n');
  return `${list.title} 보내줄게\n${places}\n${location.origin}${location.pathname}${listLink(list.id)}`;
}

async function renderLists(scope) {
  const version = routeVersion;
  if (!supports('listLists')) return mount(pageTitle('리스트'), tasteTabs('lists'));
  const g = currentGroup();
  if (!['mine', 'group', 'public'].includes(scope) || scope === 'group' && !g || scope === 'public' && !FEATURES.named) scope = 'mine';
  mount(pageTitle('리스트'), tasteTabs('lists'), loading());
  const lists = await state.store.listLists({ scope, ...(scope === 'group' ? { groupId: g.id } : {}) });
  if (version !== routeVersion) return;
  const filters = h('div', { class: 'chips list-filters', 'aria-label': '리스트 범위' },
    [['mine', '내 리스트'], ['group', '모임'], ['public', '공개']].filter(([key]) => (key !== 'group' || g) && (key !== 'public' || FEATURES.named)).map(([key, label]) =>
      h('button', { class: `chip toggle${scope === key ? ' on' : ''}`, 'aria-pressed': String(scope === key), onclick: () => go(`lists?scope=${key}`) }, label)));
  mount(pageTitle('리스트'), tasteTabs('lists'), filters,
    supports('saveList') ? h('button', { class: 'btn primary wide list-create', type: 'button', onclick: () => openListSheet() }, icon('plus', 20), '리스트 만들기') : null,
    lists.length ? lists.map((list) => h(supports('getList') ? 'a' : 'article', {
      class: 'card collection-card', ...(supports('getList') ? { href: listLink(list.id) } : {}),
    }, h('div', { class: 'collection-top' }, h('span', { class: 'badge' }, listScopeLabel(list)),
      h('small', {}, `${list.ownerName} · ${list.items.length}곳`)),
    h('h2', {}, list.title),
    list.description ? h('p', {}, list.description) : null,
    h('p', { class: 'collection-preview' }, list.items.slice(0, 3).map((item) => item.place).join(' · ')),
    supports('getList') ? icon('chevron-right', 20) : null))
      : h('section', { class: 'empty' }, plate('리', { size: 80 }), h('p', {}, '아직 리스트가 없어요')));
}

async function renderList(id) {
  const version = routeVersion;
  if (!supports('getList')) return mount(tasteTabs('lists'));
  mount(loading());
  const list = await state.store.getList(id);
  if (version !== routeVersion) return;
  if (!list) return mount(backButton('lists'), h('p', { class: 'empty' }, '리스트를 볼 수 없어요'));
  const owner = isMe(list.ownerId);
  const remove = async (event) => {
    if (!supports('deleteList') || !owner || event.currentTarget.disabled) return;
    if (!confirm('이 리스트를 지울까요?')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await state.store.deleteList(list.id);
      if (version === routeVersion) { toast('리스트를 지웠어요'); go('lists'); }
    } catch { if (version === routeVersion) toast('리스트를 지우지 못했어요'); }
    finally { button.disabled = false; }
  };
  mount(backButton('lists'), h('section', { class: 'card collection-head' },
    h('span', { class: 'badge' }, listScopeLabel(list)), h('h1', { class: 'page-title' }, list.title),
    list.description ? h('p', {}, list.description) : null, h('p', { class: 'sub-line' }, `${list.ownerName} · ${list.items.length}곳`),
    owner ? h('div', { class: 'btn-row' },
      supports('saveList') ? h('button', { class: 'btn small', onclick: () => openListSheet(list) }, '수정') : null,
      supports('deleteList') ? h('button', { class: 'btn small', onclick: remove }, '삭제') : null) : null),
  h('ol', { class: 'collection-items' }, list.items.map((item, i) => h('li', { class: 'card collection-item' },
    h('span', { class: 'collection-number', 'aria-hidden': 'true' }, i + 1),
    h('div', {}, h('b', {}, item.place), item.area ? h('p', { class: 'rank-where' }, icon('pin', 15), item.area) : null,
      item.note ? h('p', { class: 'collection-note' }, item.note) : null)))),
  h('button', { class: 'btn primary wide', onclick: () => shareText(listShareText(list)) }, icon('share', 18), '카톡으로 공유'),
  list.groupId ? h('p', { class: 'hint' }, '이 모임 친구만 링크를 열 수 있어요')
    : !list.isPublic ? h('p', { class: 'hint' }, '링크는 나만 열 수 있어요. 가게 목록은 함께 보내요') : null);
}

function openListSheet(existing = null) {
  if (!supports('saveList') || existing && !isMe(existing.ownerId)) return;
  const g = state.groups.find((group) => group.id === existing?.groupId) || currentGroup();
  const items = (existing?.items || []).map((item) => ({ place: item.place, area: item.area || '', note: item.note || '' }));
  let saving = false, hasPublicProfile = false;
  const title = h('input', { class: 'sheet-input', maxlength: 30, required: true, value: existing?.title || '', placeholder: '예: 을지로 노포 모음' });
  const description = h('textarea', { class: 'sheet-input', maxlength: 80, rows: 2, value: existing?.description || '' });
  const publicOption = h('option', { value: 'public', disabled: true }, '공개');
  const scope = h('select', { class: 'sheet-input', 'aria-label': '공개 범위' }, h('option', { value: 'mine' }, '나만'),
    g ? h('option', { value: 'group' }, `이 모임 · ${g.name}`) : null, FEATURES.named ? publicOption : null);
  scope.value = existing?.groupId ? 'group' : FEATURES.named && existing?.isPublic ? 'public' : 'mine';
  const profileHint = h('p', { class: 'sub-line', hidden: !FEATURES.named }, '공개 프로필을 확인하고 있어요');
  const rows = h('ol', { class: 'list-edit-items' });
  const count = h('p', { class: 'sub-line', role: 'status' });
  const sourceChips = h('div', { class: 'chips', 'aria-label': '가게 가져오기' });
  const suggestions = h('div', { class: 'chips list-suggestions' });
  const sourceStatus = h('p', { class: 'sub-line', role: 'status' });
  const sources = [
    { key: 'mine', label: '내 기록', rows: null },
    ...(g ? [{ key: 'group', label: '모임 순위', rows: null }] : []),
    { key: 'want', label: '가고 싶은 곳', rows: null },
  ];
  let selectedSource = 'mine';
  const place = h('input', { class: 'sheet-input', maxlength: 40, placeholder: '가게 이름', 'aria-label': '추가할 가게 이름' });
  const area = h('input', { class: 'sheet-input', maxlength: 20, placeholder: '동네', 'aria-label': '추가할 동네' });
  const note = h('input', { class: 'sheet-input', maxlength: 40, placeholder: '메모 한 줄', 'aria-label': '추가할 메모' });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, existing ? '리스트 저장' : '리스트 만들기');
  const updateSubmit = () => {
    submit.disabled = saving || !title.value.trim() || !items.length || items.some((item) => !item.place.trim())
      || scope.value === 'public' && !hasPublicProfile || scope.value === 'group' && !g;
  };
  const drawItems = () => {
    rows.replaceChildren(...items.map((item, i) => {
      const edit = (key, label, maxlength) => h('label', {}, label, h('input', {
        class: 'sheet-input', value: item[key], maxlength, required: key === 'place',
        oninput: (event) => { item[key] = event.target.value; updateSubmit(); },
      }));
      const move = (delta) => {
        if (saving) return;
        const next = i + delta;
        if (next < 0 || next >= items.length) return;
        [items[i], items[next]] = [items[next], items[i]];
        drawItems();
        rows.children[next]?.querySelector('input')?.focus();
      };
      return h('li', { class: 'list-edit-item' },
        h('div', { class: 'count-head' }, h('b', {}, `${i + 1}번째 가게`),
          h('div', { class: 'list-order' },
            h('button', { class: 'btn small', type: 'button', disabled: i === 0, 'aria-label': `${item.place || i + 1} 위로`, onclick: () => move(-1) }, '위로'),
            h('button', { class: 'btn small', type: 'button', disabled: i === items.length - 1, 'aria-label': `${item.place || i + 1} 아래로`, onclick: () => move(1) }, '아래로'),
            h('button', { class: 'btn small', type: 'button', 'aria-label': `${item.place || i + 1} 빼기`, onclick: () => {
              if (saving) return; items.splice(i, 1); drawItems();
            } }, '빼기'))),
        h('div', { class: 'place-row' }, edit('place', '가게', 40), edit('area', '동네', 20)), edit('note', '메모', 40));
    }));
    count.textContent = `${items.length}/20곳`;
    updateSubmit();
  };
  const add = (row) => {
    if (saving) return false;
    if (items.length >= 20) { toast('가게는 20곳까지 담아요'); return false; }
    if (!row.place.trim()) { toast('가게 이름을 적어 주세요'); return false; }
    if (items.some((item) => normPlace(item.place) === normPlace(row.place))) { toast('이미 담은 가게예요'); return false; }
    items.push({ place: row.place.trim().slice(0, 40), area: (row.area || '').trim().slice(0, 20), note: (row.note || '').trim().slice(0, 40) });
    drawItems();
    return true;
  };
  const drawSources = () => {
    sourceChips.replaceChildren(...sources.map((source) => h('button', {
      class: `chip toggle${selectedSource === source.key ? ' on' : ''}`, type: 'button', 'aria-pressed': String(selectedSource === source.key),
      onclick: () => { selectedSource = source.key; drawSources(); },
    }, source.label)));
    const selected = sources.find((source) => source.key === selectedSource);
    suggestions.replaceChildren(...(selected.rows || []).map((row) => h('button', {
      class: 'chip', type: 'button', onclick: () => add({ place: row.place, area: row.area }),
    }, row.place)));
    sourceStatus.textContent = selected.error ? '가게를 불러오지 못했어요. 직접 적을 수 있어요'
      : selected.rows == null ? '가게를 불러오고 있어요' : selected.rows.length ? '' : '직접 가게를 적어 주세요';
  };
  const addManual = () => {
    if (add({ place: place.value, area: area.value, note: note.value })) { place.value = ''; area.value = ''; note.value = ''; }
  };
  for (const input of [place, area, note]) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addManual(); }
  });
  title.addEventListener('input', updateSubmit);
  scope.addEventListener('change', updateSubmit);
  const fields = h('fieldset', { class: 'poll-fields list-fields' },
    h('label', {}, '제목', title), h('label', {}, '설명', description), h('label', {}, '공개 범위', scope), profileHint,
    h('h4', {}, '담은 가게'), count, rows,
    h('h4', {}, '가게 추가'), sourceChips, suggestions, sourceStatus,
    h('div', { class: 'place-row' }, place, area), note,
    h('button', { class: 'btn wide', type: 'button', onclick: addManual }, '직접 추가'));
  const form = h('form', { class: 'list-form' }, fields, submit);
  drawItems(); drawSources();
  const close = openModal(h('h3', {}, existing ? '리스트 수정' : '리스트 만들기'), form);
  let active = true;
  modalCleanup = () => { active = false; };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateSubmit();
    if (submit.disabled) return;
    if (new Set(items.map((item) => normPlace(item.place))).size !== items.length) return toast('같은 가게가 두 번 들어 있어요');
    saving = true; fields.disabled = true; updateSubmit();
    try {
      const list = await state.store.saveList({ ...(existing ? { id: existing.id } : {}),
        groupId: scope.value === 'group' ? g.id : null, isPublic: scope.value === 'public',
        title: title.value.trim(), description: description.value.trim(),
        items: items.map((item) => ({ place: item.place.trim(), area: item.area.trim(), note: item.note.trim() })),
      });
      if (active) { close(); toast('리스트를 저장했어요'); go(supports('getList') ? `l/${encodeURIComponent(list.id)}` : 'lists'); }
    } catch { if (active) toast('리스트를 저장하지 못했어요. 다시 해 주세요'); }
    finally { saving = false; fields.disabled = false; updateSubmit(); }
  });
  (async () => {
    try {
      hasPublicProfile = FEATURES.named && supports('myPublicProfile') && Boolean(await state.store.myPublicProfile());
      if (!active) return;
      publicOption.disabled = !hasPublicProfile;
      profileHint.textContent = hasPublicProfile ? '공개 리스트는 누구나 볼 수 있어요' : '공개 프로필이 있으면 공개할 수 있어요';
    } catch { if (active) profileHint.textContent = '공개 프로필을 확인하지 못했어요'; }
    if (active) updateSubmit();
  })();
  (async () => {
    const results = await Promise.allSettled(sources.map(async (source) => {
      if (source.key === 'mine') return placeRanking(await myPosts());
      if (source.key === 'group') return placeRanking(await feedOf(g.id, addDays(today(), -RANK_DAYS)));
      const [wants, mine] = await Promise.all([myWants(), myPosts()]);
      return wishlist(wants, mine).todo;
    }));
    if (!active) return;
    results.forEach((result, i) => {
      sources[i].rows = result.status === 'fulfilled' ? result.value : [];
      sources[i].error = result.status === 'rejected';
    });
    drawSources();
  })();
}

// ---------------- 네임드 프로필 ----------------

const reactionsReceived = (posts) => posts.reduce((n, p) => n + (p.reactions || []).length, 0);

function titleBadges(titles) {
  return h('div', { class: 'title-badges' }, titles.map((t) =>
    h('span', { class: 'badge title-badge', title: t.desc }, t.label, h('small', {}, t.desc))));
}

async function renderMembers() {
  const version = routeVersion;
  const g = currentGroup();
  mount(loading());
  const posts = await feedOf(g.id, '0001-01-01');
  if (version !== routeVersion) return;
  const people = g.members.map((m) => {
    const mine = posts.filter((p) => p.userId === m.userId);
    return { ...m, count: mine.length, reactions: reactionsReceived(mine), days: streak(mine, m.userId, today()), titles: titlesFor(posts, m.userId, today()) };
  }).sort((a, b) => b.reactions - a.reactions || b.count - a.count || a.nickname.localeCompare(b.nickname, 'ko'));
  mount(h('div', { class: 'scr-members' },
    screenHeader({ back: 'settings', title: '모임 멤버' }),
    h('p', { class: 'members-sub' }, `${g.name} · ${g.members.length}명`),
    h('nav', { class: 'card member-rows', 'aria-label': '모임 멤버' },
      visibleItems('member', people).map((m) => h('a', { class: 'member-row', href: profileLink(g.id, m.userId) },
        avatar(m.nickname, { size: 48 }),
        h('div', { class: 'member-row-body' },
          h('div', { class: 'member-row-name' }, h('b', {}, m.nickname),
            isMe(m.userId) ? h('span', { class: 'member-me' }, '나') : null,
            m.titles.length ? h('span', { class: 'me-title-chip', title: m.titles[0].desc }, m.titles[0].label) : null),
          h('p', {}, `기록 ${m.count} · 반응 ${m.reactions} · ${m.days}일 연속`)),
        icon('chevR', 18))))));
}

function bioEditor(g, member) {
  const wrap = h('div', { class: 'profile-bio' });
  const draw = () => wrap.replaceChildren(...[
    h('p', { class: member.bio ? '' : 'bio-empty' }, member.bio || '아직 소개가 없어요'),
    isMe(member.userId) && supports('setBio') ? h('button', {
      class: 'btn ghost small bio-edit', type: 'button', onclick: edit,
    }, member.bio ? '소개 고치기' : '소개 쓰기') : null,
  ].filter(Boolean));
  const edit = () => {
    const input = h('input', { class: 'sheet-input', value: member.bio || '', maxlength: 60, 'aria-label': '한 줄 소개', placeholder: '한 줄 소개' });
    const count = h('small', {}, `${input.value.length}/60`);
    input.addEventListener('input', () => { count.textContent = `${input.value.length}/60`; });
    const save = h('button', { class: 'btn primary small', type: 'submit' }, '저장');
    const cancel = h('button', { class: 'btn small', type: 'button', onclick: draw }, '취소');
    const form = h('form', {}, input, count, h('div', { class: 'btn-row' }, save, cancel));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      const bio = input.value.trim();
      save.disabled = cancel.disabled = true;
      input.disabled = true;
      try {
        await state.store.setBio(g.id, bio);
        member.bio = bio;
        draw();
        toast('소개를 저장했어요');
      } catch {
        toast('소개를 저장하지 못했어요');
        save.disabled = cancel.disabled = input.disabled = false;
      }
    });
    wrap.replaceChildren(form);
    input.focus();
  };
  draw();
  return wrap;
}

async function renderProfile(groupId, userId) {
  const version = routeVersion;
  const g = state.groups.find((x) => x.id === groupId);
  const member = g?.members.find((m) => m.userId === userId);
  if (!member) return mount(backButton('members'), h('p', { class: 'empty' }, '프로필을 찾을 수 없어요'));
  if (hiddenContent('member', member)) return mount(backButton('members'), h('p', { class: 'empty' }, '숨긴 프로필이에요'));
  setGroup(g.id);
  mount(loading());
  const posts = await feedOf(g.id, '0001-01-01');
  const bowls = await bowlsSection(userId);
  if (version !== routeVersion) return;
  const mine = posts.filter((p) => p.userId === userId).sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt));
  const rows = placeRanking(mine);
  const days = streak(mine, userId, today());
  const favorites = rows.filter((r) => r.count >= 2).sort((a, b) => b.count - a.count || b.recommend - a.recommend);
  const titles = titlesFor(posts, userId, today());
  const placeRow = (row, label) => h('a', { class: 'profile-place', href: placeLink(g.id, row.place) },
    photoEl(row, 'photo'), h('div', {}, h('small', {}, label), h('b', {}, row.place),
      h('span', {}, [row.area, `추천 ${fmt1(row.recommend)}`, `${row.count}번`].filter(Boolean).join(' · '))), icon('chevR', 18));
  const stat = (label, value) => h('div', { class: 'me-stat' }, h('span', {}, label), h('b', {}, value));
  mount(h('div', { class: 'scr-profile' },
    screenHeader({ back: 'members', title: isMe(userId) ? '나의 식탁' : '친구의 식탁',
      right: moderationMenu({ groupId, targetType: 'member', targetId: userId, targetUser: userId }, { member: true }) }),
    h('section', { class: 'me-profile' },
      avatar(member.nickname, { size: 64 }),
      h('div', { class: 'me-profile-body' },
        h('div', { class: 'me-name-row' }, h('h1', { class: 'me-name' }, member.nickname)),
        bioEditor(g, member))),
    h('div', { class: 'me-stats' }, stat('기록', mine.length), stat('간 곳', rows.length), stat('받은 반응', reactionsReceived(mine))),
    streakLine(days),
    titles.length ? titleBadges(titles) : null,
    bowls,
    h('section', { class: 'profile-block' }, h('h2', { class: 'rec-list-title' }, '베스트 3'),
      rows.length ? h('div', { class: 'card profile-places' }, rows.slice(0, 3).map((r, i) => placeRow(r, `${i + 1}위`)))
        : h('p', { class: 'hint' }, '아직 기록이 없어요')),
    h('section', { class: 'profile-block' }, h('h2', { class: 'rec-list-title' }, '자주 가는 곳'),
      favorites.length ? h('div', { class: 'card profile-places' }, favorites.map((r) => placeRow(r, `${r.count}번 다녀왔어요`)))
        : h('p', { class: 'hint' }, '두 번 간 곳이 없어요')),
    h('h2', { class: 'rec-list-title' }, '기록 모음', h('small', {}, `${mine.length}개`)),
    ...mine.map((p) => postCard(p, { groupId: g.id, showDate: true }))));
}

// ---------------- 모임 투표·오늘의 가게 ----------------

function tasteActions(g) {
  return h('div', { class: 'taste-actions' },
    h('button', { class: 'btn small', type: 'button', onclick: () => openPicker(g) }, '뭐 먹지?'),
    supports('listPolls', 'createPoll') ? h('button', { class: 'btn small', type: 'button', onclick: () => openPollSheet(g) }, '투표 만들기') : null);
}

async function placePool(g) {
  const [posts, wants, mine] = await Promise.all([feedOf(g.id, addDays(today(), -RANK_DAYS)), myWants(), myPosts()]);
  const ranks = placeRanking(posts);
  const pool = new Map(ranks.filter((r) => r.recommend >= 4).map((r) => [r.placeKey, { ...r, groupId: g.id, wanted: false }]));
  for (const want of wishlist(wants, mine).todo) {
    if (!state.groups.some((x) => x.id === want.groupId)) continue;
    const row = ranks.find((r) => r.placeKey === want.placeKey);
    pool.set(want.placeKey, { ...want, ...row, groupId: row ? g.id : want.groupId, wanted: true });
  }
  return [...pool.values()];
}

async function openPicker(g) {
  const version = routeVersion;
  const result = h('div', { class: 'picker-result', 'aria-live': 'polite' }, '가게를 불러오고 있어요');
  const close = openModal(h('h3', {}, '오늘 뭐 먹지?'), result);
  let active = true;
  let interval;
  let timer;
  modalCleanup = () => { active = false; clearInterval(interval); clearTimeout(timer); };
  try {
    const pool = await placePool(g);
    if (!active || version !== routeVersion) return;
    if (!pool.length) {
      result.replaceChildren(h('p', {}, '아직 고를 가게가 없어요'));
      return;
    }
    const draw = () => {
      const row = pickPlace(pool);
      const best = [...(row.posts || [])].filter((p) => !isMe(p.userId)).sort((a, b) => b.recommend - a.recommend)[0];
      const reason = best ? `${best.nickname}${josa(best.nickname, '이', '가')} ${best.recommend}점 준 집`
        : row.wanted ? '가고 싶은 곳에 담았어요' : `모임 추천 평균 ${fmt1(row.recommend)}점`;
      result.replaceChildren(h('div', { class: 'picker-place' }, photoEl(row, 'photo'), h('h4', {}, row.place),
        row.area ? h('p', { class: 'sub-line' }, row.area) : h('span'), h('p', {}, reason)),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: placeLink(row.groupId, row.place), onclick: close }, '가게 보기'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          close();
          openInviteSheet({ groupId: row.groupId, place: row.place, area: row.area, photoUrl: row.photoUrl });
        } }, '같이 가자')),
      h('button', { class: 'btn wide', type: 'button', onclick: spin }, '다시 뽑기'));
    };
    const spin = () => {
      clearInterval(interval);
      clearTimeout(timer);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return draw();
      const name = h('b', { class: 'picker-spinning', 'aria-hidden': 'true' }, pool[0].place);
      result.replaceChildren(h('p', {}, '가게를 고르고 있어요'), name);
      let i = 0;
      interval = setInterval(() => { name.textContent = pool[++i % pool.length].place; }, 75);
      timer = setTimeout(() => { clearInterval(interval); if (active) draw(); }, 1200);
    };
    spin();
  } catch {
    if (active) result.replaceChildren(h('p', {}, '가게를 불러오지 못했어요'));
  }
}

const pollEnded = (poll) => poll.closed || Boolean(poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now());

function onRouteLeave(cleanup) {
  const previous = routeCleanup;
  routeCleanup = () => { previous?.(); cleanup(); };
}

function pollCard(initial, { registerCleanup = true } = {}) {
  let poll = initial;
  let busy = false;
  let expiry;
  const version = routeVersion;
  const card = h('article', { class: 'card poll-card' });
  const act = async (kind, idx) => {
    if (busy) return;
    if (kind === 'vote' && pollEnded(poll)) { draw(); return toast('마감된 투표예요'); }
    busy = true;
    draw();
    try {
      poll = kind === 'close' ? await state.store.closePoll(poll.id) : await state.store.votePoll(poll.id, idx);
      if (version === routeVersion) toast(kind === 'close' ? '투표를 마감했어요' : idx == null ? '투표를 취소했어요' : '투표했어요');
    } catch {
      if (version === routeVersion) toast('투표를 저장하지 못했어요');
    } finally {
      busy = false;
      if (version === routeVersion) draw();
    }
  };
  const draw = () => {
    clearTimeout(expiry);
    const closed = pollEnded(poll);
    const votes = poll.votes || [];
    const mine = votes.find((v) => isMe(v.userId));
    const counts = poll.options.map((_, i) => votes.filter((v) => v.optionIdx === i).length);
    const max = Math.max(0, ...counts);
    const winnerIds = counts.map((n, i) => n === max && max > 0 ? i : -1).filter((i) => i >= 0);
    const endLabel = closed ? '마감됐어요' : poll.closesAt
      ? `${dateLabel(ymd(new Date(poll.closesAt)), today())} ${timeLabel(poll.closesAt)} 마감` : '마감일이 없어요';
    card.replaceChildren(
      h('div', { class: 'poll-head' }, h('span', { class: 'poll-kicker' }, '투표'), h('h3', {}, poll.title),
        h('small', { class: `poll-end${closed ? ' closed' : ''}` }, icon(closed ? 'check-circle' : 'calendar', 16), endLabel)),
      h('div', { class: 'poll-options' }, poll.options.map((option, i) => {
        const people = votes.filter((v) => v.optionIdx === i);
        const picked = mine?.optionIdx === i;
        return h('button', {
          class: `poll-option${picked ? ' on' : ''}${closed && winnerIds.includes(i) ? ' winner' : ''}`,
          type: 'button', disabled: closed || busy || !supports('votePoll'),
          'aria-pressed': String(picked),
          onclick: () => act('vote', picked ? null : i),
        }, h('span', { class: 'poll-fill', style: { width: `calc((100% - 28px) * ${votes.length ? counts[i] / votes.length : 0})` } }),
        h('span', { class: 'poll-option-body' }, h('b', {}, option.place),
          h('small', {}, [option.area, closed && winnerIds.includes(i) ? '1위' : ''].filter(Boolean).join(' · ')),
          h('span', { class: 'poll-voters' }, people.map((v) => h('span', {
            class: 'avatar', title: nickOf(poll.groupId, v.userId), 'aria-label': nickOf(poll.groupId, v.userId),
          }, nickOf(poll.groupId, v.userId).slice(0, 1))))),
        h('span', { class: 'poll-count' }, h('b', {}, String(counts[i])), '표'),
        h('span', { class: 'poll-check', 'aria-hidden': 'true' }, picked ? icon('check', 16) : null));
      })),
      h('div', { class: 'poll-foot' }, h('small', {}, `${votes.length}명 투표`),
        h('small', { class: 'poll-by' }, nickLink(poll.groupId, poll.creatorId,
          `${nickOf(poll.groupId, poll.creatorId)}${josa(nickOf(poll.groupId, poll.creatorId), '이', '가')}`), ' 만든 투표')),
      ...(!closed && isMe(poll.creatorId) && supports('closePoll') ? [h('button', {
        class: 'btn small', type: 'button', disabled: busy, onclick: () => act('close'),
      }, '마감하기')] : []),
      ...(closed && winnerIds.length ? winnerIds.map((i) => h('div', { class: 'poll-winner' },
        h('b', {}, poll.options[i].place), h('button', { class: 'btn small primary', type: 'button',
          onclick: () => openInviteSheet({ groupId: poll.groupId, ...poll.options[i] }),
        }, '같이 가자'))) : []),
      ...(closed && !votes.length ? [h('p', { class: 'hint' }, '투표한 사람이 없어요')] : []));
    if (!closed && poll.closesAt) expiry = setTimeout(draw, Math.min(2147483647, Math.max(1, new Date(poll.closesAt).getTime() - Date.now())));
  };
  card.dispose = () => clearTimeout(expiry);
  if (registerCleanup) onRouteLeave(card.dispose);
  draw();
  return card;
}

async function openPollSheet(g) {
  if (!supports('listPolls', 'createPoll')) return;
  const title = h('input', { class: 'sheet-input', maxlength: 40, value: '어디 갈까?', required: true, 'aria-label': '투표 제목' });
  const options = [];
  const chosen = h('div', { class: 'chips poll-chosen' });
  const suggestions = h('div', { class: 'chips' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }, '후보를 불러오고 있어요');
  const place = h('input', { class: 'sheet-input', maxlength: 40, placeholder: '가게 이름', 'aria-label': '가게 이름' });
  const area = h('input', { class: 'sheet-input', maxlength: 20, placeholder: '동네', 'aria-label': '동네' });
  const deadline = h('select', { class: 'sheet-input', 'aria-label': '투표 마감' },
    h('option', { value: 'none' }, '마감 없음'), h('option', { value: 'tomorrow' }, '내일까지'), h('option', { value: 'sunday' }, '이번 주 일요일까지'));
  const submit = h('button', { class: 'btn primary wide', type: 'submit', disabled: true }, '투표 만들기');
  let saving = false;
  const draw = () => {
    chosen.replaceChildren(...options.map((o, i) => h('button', { class: 'chip on-soft', type: 'button',
      'aria-label': `${o.place} 빼기`, onclick: () => { options.splice(i, 1); draw(); },
    }, o.place, icon('close', 16))));
    submit.disabled = saving || options.length < 2 || !title.value.trim();
  };
  const add = (row) => {
    if (saving) return;
    if (!row.place.trim()) return toast('가게 이름을 적어 주세요');
    if (options.some((o) => normPlace(o.place) === normPlace(row.place))) return toast('이미 고른 가게예요');
    if (options.length >= 6) return toast('가게는 6곳까지 골라요');
    options.push({ place: row.place.trim(), area: (row.area || '').trim() });
    draw();
  };
  title.addEventListener('input', draw);
  const addManual = () => {
    const count = options.length;
    add({ place: place.value, area: area.value });
    if (options.length > count) { place.value = ''; area.value = ''; }
  };
  for (const input of [place, area]) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addManual(); }
  });
  const fields = h('fieldset', { class: 'poll-fields' },
    h('label', { class: 'row-label' }, '제목', title),
    h('p', { class: 'row-label' }, '가게를 2곳부터 6곳 골라요'), chosen, suggestions, status,
    h('div', { class: 'place-row' }, place, area),
    h('button', { class: 'btn small poll-add', type: 'button', onclick: addManual }, icon('plus', 18), '직접 추가'),
    h('label', { class: 'row-label' }, '마감', deadline));
  const form = h('form', { class: 'poll-sheet' }, fields, submit);
  const close = openModal(h('h3', {}, '투표 만들기'), form);
  let active = true;
  modalCleanup = () => { active = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving || options.length < 2 || options.length > 6 || !title.value.trim()) return;
    let closesAt = null;
    if (deadline.value !== 'none') {
      const end = parseYmd(today());
      end.setDate(end.getDate() + (deadline.value === 'tomorrow' ? 1 : (7 - end.getDay()) % 7));
      end.setHours(23, 59, 59, 999);
      closesAt = end.toISOString();
    }
    saving = true;
    fields.disabled = true;
    draw();
    try {
      await state.store.createPoll(g.id, { title: title.value.trim(), options: options.map((o) => ({ ...o })), closesAt });
      if (active) { close(); toast('투표를 만들었어요'); route(); }
    } catch {
      if (active) toast('투표를 만들지 못했어요');
    } finally {
      saving = false;
      fields.disabled = false;
      draw();
    }
  });
  try {
    const [posts, wants, mine] = await Promise.all([feedOf(g.id, addDays(today(), -RANK_DAYS)), myWants(), myPosts()]);
    if (!active) return;
    const pool = new Map([...placeRanking(posts), ...wishlist(wants, mine).todo].map((r) => [normPlace(r.place), r]));
    suggestions.replaceChildren(...[...pool.values()].map((row) => h('button', { class: 'chip', type: 'button', onclick: () => add(row) }, row.place)));
    status.textContent = pool.size ? '' : '직접 가게를 적을 수 있어요';
  } catch {
    if (active) status.textContent = '후보를 불러오지 못했어요';
  }
}

// ---------------- 가게 한 곳 ----------------

async function renderPlace(groupId, placeKey) {
  const version = routeVersion;
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return go('rank');
  mount(loading());
  const posts = (await feedOf(g.id, '0001-01-01')).filter((p) => normPlace(p.place) === placeKey);
  const expert = posts.length ? await expertCard(posts[0].place, representativeCategory(posts)) : null;
  if (version !== routeVersion) return;
  if (!posts.length) {
    return mount(screenHeader({ back: 'rank', title: '가게 상세' }),
      h('section', { class: 'empty' }, plate('?', { size: 88 }), h('p', {}, '이 가게 기록이 없어요'),
        h('a', { class: 'btn', href: '#/rank' }, '우리 맛집으로')));
  }
  const [row] = placeRanking(posts);
  const visited = posts.some((p) => isMe(p.userId));
  const target = visibleItems('post', row.posts).find((p) => !isMe(p.userId)); // '나도 갈래'를 걸 글 = 남의 가장 최근 글
  const photos = visibleItems('post', row.posts).filter((p) => p.photoUrl).slice(0, 3);
  const names = [...new Set(row.posts.map((p) => p.userId))].map((uid) => nickOf(g.id, uid) || '친구');

  const wantBtn = h('button', { class: 'btn place-want', type: 'button' });
  const drawWant = () => {
    const on = (target?.reactions || []).some((r) => isMe(r.userId) && r.kind === 'want');
    wantBtn.className = `btn place-want${on ? ' on-soft' : ''}`;
    wantBtn.setAttribute('aria-pressed', String(on));
    wantBtn.replaceChildren(icon(on ? 'check' : 'plus', 18), on ? '담았어요' : '가고 싶어요');
  };
  if (target && !visited) {
    drawWant();
    // 위 버튼과 아래 글 카드가 같은 반응을 보여 주므로, 누른 뒤 화면 전체를 다시 그려 맞춘다
    wantBtn.addEventListener('click', async () => {
      await react(target, g.id, 'want', drawWant);
      route();
    });
  }

  mount(
    screenHeader({ back: 'rank', title: row.place }),
    h('section', { class: 'place-head' },
      h('div', { class: `place-photos n${Math.max(1, photos.length)}` },
        photos.length ? photos.map((p) => photoEl(p, 'meal-photo')) : photoEl(row, 'meal-photo')),
      h('div', { class: 'place-title' },
        h('div', { class: 'place-name' },
          h('h1', { class: 'page-title' }, row.place),
          row.area ? h('p', { class: 'place-where' }, icon('pin', 16), row.area) : null),
        h('div', { class: 'place-who' }, avatarStack(names, { max: 3 }))),
      h('p', { class: 'sub-line' }, `${row.visitors}명이 ${row.count}번 갔어요 · 마지막 ${dateLabel(row.last, today())}`),
      h('div', { class: 'place-avgs-card' }, scoreChips(row)),
      target && !visited ? wantBtn : null,
      h('div', { class: 'place-actions' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => openInviteSheet({ groupId: g.id, place: row.place, area: row.area, postId: (target || row.posts[0]).id, photoUrl: row.photoUrl }),
        }, icon('calendar', 18), '같이 가자'),
        h('a', { class: 'btn primary', href: recordLink({ place: row.place, area: row.area }) }, icon('camera', 18), '나도 기록하기'))),
    expert,
    h('h2', { class: 'day' }, '다녀온 기록', h('small', {}, `${posts.length}개`)),
    ...row.posts.map((p) => postCard(p, { groupId: g.id, showDate: true })));
}

// ---------------- 월말 결산 ----------------

async function renderMonth(ym, scope) {
  const version = routeVersion;
  const g = currentGroup();
  if (scope === 'group' && !g) scope = 'me';
  mount(screenHeader({ back: 'rank', title: '이달 결산' }), loading());
  const posts = scope === 'group' ? await feedOf(g.id, `${ym}-01`) : await state.store.myPostsInMonth(ym);
  if (version !== routeVersion) return;
  const s = monthSummary(posts, ym);
  const thisMonth = monthOf(today());
  const scopeName = scope === 'group' ? g.name : '나의 기록';
  const monthPosts = posts.filter((p) => monthOf(p.eatenOn) === ym);

  // 코발트 윗부분: 머리줄(뒤로 · 달 이동) + 큰 문장 + 원형 접시 사진
  const plates = [...new Map(monthPosts.filter((p) => p.photoUrl)
    .sort((a, b) => b.recommend - a.recommend || b.eatenOn.localeCompare(a.eatenOn))
    .map((p) => [p.photoUrl, p])).values()].slice(0, 3);
  const hero = h('section', { class: 'month-hero' },
    h('header', { class: 'screen-header month-head' },
      h('button', { type: 'button', class: 'icon-btn back-button', 'aria-label': '뒤로',
        onclick: () => (history.length > 1 ? history.back() : go('rank')) }, icon('back')),
      h('div', { class: 'month-head-title' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '이전 달', onclick: () => go(`month?ym=${shiftMonth(ym, -1)}&scope=${scope}`) }, icon('chevL', 20)),
        h('div', {}, h('h2', { class: 'screen-header-title' }, `${monthLabel(ym)}의 한입`), h('small', {}, scopeName)),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': '다음 달', disabled: ym >= thisMonth,
          onclick: () => go(`month?ym=${shiftMonth(ym, 1)}&scope=${scope}`),
        }, icon('chevR', 20))),
      h('span')),
    h('p', { class: 'month-lead' }, '이번 달도', h('br'), '맛있게 살았다.'),
    g ? h('div', { class: 'month-scope', role: 'group', 'aria-label': '결산 범위' },
      h('button', { type: 'button', 'aria-pressed': String(scope === 'group'), onclick: () => go(`month?ym=${ym}&scope=group`) }, h('span', { class: 'month-scope-name' }, g.name)),
      h('button', { type: 'button', 'aria-pressed': String(scope === 'me'), onclick: () => go(`month?ym=${ym}&scope=me`) }, '나')) : null,
    h('div', { class: `month-plates n${Math.max(1, plates.length)}`, 'aria-hidden': 'true' },
      plates.length ? plates.map((p) => h('span', { class: 'month-plate' }, h('img', { src: p.photoUrl, alt: '', loading: 'lazy', decoding: 'async',
        onerror: (event) => { event.currentTarget.replaceWith(plate(p.place, { size: 120 })); } })))
        : plate(s.total ? s.bestRecommend?.place || '한입' : '한입', { size: 120 }),
      h('span', { class: 'month-lemon' })));

  const reportLink = h('a', { class: 'month-report-link', href: `#/report?ym=${ym}` },
    h('span', {}, `${monthLabel(ym)} 나의 리포트`), icon('chevron-right', 20));
  if (!s.total) {
    return mount(hero, h('section', { class: 'month-sheet' },
      h('div', { class: 'empty' }, h('p', {}, `${monthLabel(ym)}엔 기록이 없어요`),
        ym === thisMonth ? h('a', { class: 'btn primary', href: '#/post' }, '첫 기록 남기기') : null)), reportLink);
  }

  const taste = monthlyTaste(monthPosts, ym);
  const kinds = taste.categories.slice(0, 3);
  const others = taste.categories.slice(3).reduce((n, c) => n + c.count, 0);
  if (others) kinds.push({ key: 'rest', label: '그 외', count: others });
  const favorite = taste.favorite;
  const kindCard = favorite ? h('div', { class: 'month-kinds' },
    h('div', { class: 'month-kinds-head' }, h('span', {}, '많이 먹은 종류'), h('b', {}, `${favorite.label} ${favorite.count}회`)),
    h('div', { class: 'month-bar', role: 'img', 'aria-label': kinds.map((k) => `${k.label} ${k.count}회`).join(', ') },
      kinds.map((k, i) => h('span', { class: `step${i}`, style: { flexGrow: String(k.count) } }))),
    h('ul', { class: 'month-legend' }, kinds.map((k, i) => h('li', {}, h('i', { class: `step${i}` }), `${k.label} ${k.count}`)))) : null;

  const best = s.bestRecommend;
  const bestBody = [photoEl(best, 'month-thumb'),
    h('div', { class: 'month-best-body' }, h('span', {}, '이달의 한입'), h('b', {}, best.place), scoreInline('추천', best.recommend))];
  const bestRow = scope === 'group'
    ? h('a', { class: 'month-best', href: placeLink(g.id, best.place) }, ...bestBody, icon('chevron-right', 20))
    : h('div', { class: 'month-best' }, ...bestBody);

  const award = (label, name, valueText) => h('li', {},
    h('div', { class: 'month-award-body' }, h('span', {}, label), name), h('small', {}, valueText));
  const awards = h('ul', { class: 'month-awards' },
    award('제일 많이 간 곳', h('b', {}, s.mostVisited?.place || '-'), `${s.mostVisited.count}번`),
    award('가성비왕', h('b', {}, s.bestWorth?.place || '-'), `가성비 ${fmt1(s.bestWorth.worth)}`),
    award('맛 1위', h('b', {}, s.bestTaste?.place || '-'), `맛 ${fmt1(s.bestTaste.taste)}`),
    scope === 'group' && s.mvp
      ? award('이달의 먹보', nickLink(g.id, s.mvp.userId, s.mvp.nickname), `${s.mvp.count}끼 올림`)
      : null);

  const saveBtn = h('button', {
    class: 'btn primary wide month-save', type: 'button',
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const canvas = await drawMonthCard({ scopeName, summary: monthSummary(await originalPhotos(monthPosts), ym), isGroup: scope === 'group', taste: monthlyTaste(monthPosts, ym) });
        await showCard(canvas, `hanip-${ym}-${scope}.jpg`, `${monthLabel(ym)} 결산 카드`);
      } catch {
        toast('카드를 만들지 못했어요');
      } finally {
        btn.disabled = false;
      }
    },
  }, icon('download', 20), '결산 카드 저장');

  mount(hero,
    h('section', { class: 'month-sheet' },
      h('div', { class: 'month-total' },
        h('p', {}, h('b', {}, s.total), '번의 식사'),
        h('small', {}, scope === 'group'
          ? `${s.placeCount}곳 · 같이 먹은 날 ${s.mealCount}일`
          : `${s.placeCount}곳 · 평균 맛 ${fmt1(s.averages.taste)}`)),
      kindCard, bestRow, awards),
    saveBtn, reportLink);
}

// ---------------- 모임 식사 카드 ----------------

async function renderMeal(groupId, date, placeKey) {
  const version = routeVersion;
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return go('feed');
  mount(loading());
  const posts = await feedOf(g.id);
  if (version !== routeVersion) return;
  const original = detectMealCards(posts).find((m) => m.eatenOn === date && m.placeKey === placeKey);
  const card = original ? { ...original, posts: visibleItems('post', original.posts) } : null;
  if (!card?.posts.length) {
    return mount(h('section', { class: 'empty' }, h('p', {}, '카드를 찾을 수 없어요'),
      h('button', { class: 'btn', onclick: () => go('feed') }, '피드로')));
  }
  // 공유 창은 누른 순간에 열려야 해서 카드 그림을 미리 만들어 둔다
  const canvas = await drawMealCard({ groupName: g.name, card: { ...card, posts: await originalPhotos(card.posts) } });
  if (version !== routeVersion) return;
  const btn = h('button', { type: 'button', class: 'btn primary wide meal-save' }, icon('download', 20), '식사 카드 저장');
  btn.addEventListener('click', async () => {
    try {
      const r = await shareCanvas(canvas, `hanip-${date}-${placeKey}.jpg`, `${card.place} 식사 카드`);
      if (r === 'downloaded') toast('이미지를 저장했어요', undefined, { type: 'success' });
    } catch {
      toast('이미지를 만들지 못했어요', undefined, { type: 'error' });
    }
  });
  const hero = card.posts.find((p) => p.photoUrl) || card.posts[0];
  const area = card.posts.find((p) => p.area)?.area || '';
  const names = card.posts.map((p) => p.nickname);
  const ateToo = card.posts.some((p) => isMe(p.userId));
  const firstOther = card.posts.find((p) => !isMe(p.userId));
  const md = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
  const friends = h('ul', { class: 'meal-friends' }, card.posts.map((p) => {
    const nReact = (p.reactions || []).length;
    const nCmt = (p.comments || []).length;
    return h('li', {},
      h('div', { class: 'meal-friend-body' },
        h('div', { class: 'meal-friend-top' },
          personLink(nickLink(g.id, p.userId, p.nickname), avatar(p.nickname, { size: 44 })), postVerification(p),
          h('small', {}, md(p.eatenOn))),
        p.note ? h('p', { class: 'note' }, p.note) : null,
        h('div', { class: 'meal-friend-scores' }, METRICS.map((m) => scoreInline(m.label, p[m.key]))),
        h('div', { class: 'meal-friend-actions' },
          h('a', { class: 'mini-social', href: postLink(g.id, p) },
            nReact || nCmt ? [nReact ? `반응 ${nReact}` : null, nReact && nCmt ? ' · ' : null, nCmt ? `댓글 ${nCmt}` : null] : '반응·댓글 남기기',
            icon('chevron-right', 16)),
          isMe(p.userId) ? h('button', { class: 'icon-btn', 'aria-label': '내 기록 삭제', onclick: () => confirmDelete(p) }, icon('trash', 18)) : postMenu(p, g.id))));
  }));
  mount(h('div', { class: 'scr-meal' },
    screenHeader({ back: 'feed', title: '같이 먹은 기록' }),
    h('div', { class: 'meal-hero' }, photoEl(hero, 'meal-hero-photo', { original: true })),
    h('section', { class: 'meal-sheet' },
      h('div', { class: 'meal-who' }, avatarStack(names, { max: 4 }), h('small', {}, `${original.posts.length}명이 함께 먹었어요`)),
      h('div', { class: 'meal-title-row' },
        h('h1', { class: 'meal-title' }, h('a', { href: placeLink(g.id, card.place) }, card.place)),
        h('span', { class: 'pill' }, g.name)),
      area ? h('div', { class: 'meal-area' }, icon('pin', 16), area) : null,
      scoreChips(card.averages),
      h('div', { class: 'meal-friends-head' },
        h('h2', {}, '친구들의 한입'),
        ateToo ? null : h('a', { class: 'btn ghost', href: recordLink({ place: card.place, area, date, withId: firstOther?.userId || '' }) }, '나도 먹었어요')),
      friends),
    h('div', { class: 'meal-save-bar' }, btn)));
}

// ---------------- 같이 가자 (1:1 초대) ----------------
// 원칙: 같은 모임 친구끼리만 · 둘만 봄 · "이번엔 패스"는 부드럽게 · 패스 뒤 7일 재신청 불가 · 초대 그만 받기 가능.

function pickedChoice(v) {
  return (v.choices || []).find((c) => c.label === v.picked) || null;
}

function inviteShareText(v, groupId) {
  const to = nickOf(groupId, v.toUserId);
  const when = (v.choices || []).map((c) => choiceLabel(c, today())).join(', ');
  return `${to}${josa(to, '아', '야')} ${v.place} 같이 갈래?\n${when} 어때${v.message ? `\n${v.message}` : ''}\n답은 여기서 ${location.origin}${location.pathname}#/t/${encodeURIComponent(v.threadId)}`;
}

async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  if (await copyText(text)) toast('복사했어요. 카톡에 붙여넣으면 돼요');
}

const QUICK_NOTES = ['여기 가보고 싶었어', '시간 되면 가자', '밥 한번 먹자'];

// 보내기 창: 가게 카드 → 누구랑 → 1주일 달력 칸(점심·저녁) → 한마디 → 받는 화면 미리보기 → "○○에게 보내기"
function openInviteSheet({ groupId, place, area = '', postId = null, toUserId = null, photoUrl = null }) {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return;
  const friends = g.members.filter((m) => !isMe(m.userId) && (!toUserId || m.userId === toUserId));
  if (!friends.length) return toast('모임에 친구를 먼저 불러주세요');
  const pick = {
    to: friends.some((f) => f.userId === toUserId) ? toUserId : friends.length === 1 ? friends[0].userId : null,
    keys: [], // 고른 순서 유지
  };
  const grid = slotGrid(new Date());
  const all = new Map([...grid.cols.flatMap((c) => c.slots), grid.nextWeek].map((o) => [o.key, o]));
  const myNick = g.myNickname || '나';

  let sending = false;
  const whoBox = h('div', { class: 'who-pick' });
  const gridBox = h('div', { class: 'slot-grid', role: 'group', 'aria-label': '언제' });
  const nextWeekBtn = h('button', { type: 'button', class: 'chip toggle next-week' }, grid.nextWeek.short);
  const picked = h('div', { class: 'slot-picked' });
  const msg = h('input', { class: 'sheet-input', maxlength: 60, placeholder: '직접 쓰기' });
  const quick = h('div', { class: 'chips quick' });
  const preview = h('div', { class: 'invite-preview' });
  const send = h('button', { class: 'btn primary wide big', type: 'button' });

  const toggleKey = (key) => {
    const i = pick.keys.indexOf(key);
    if (i >= 0) pick.keys.splice(i, 1);
    else if (pick.keys.length >= 3) return toast('3개까지 고를 수 있어요');
    else pick.keys.push(key);
    draw();
  };

  const draw = () => {
    whoBox.replaceChildren(...friends.map((f) => h('button', {
      type: 'button', class: `who-chip${pick.to === f.userId ? ' on' : ''}`, 'aria-pressed': String(pick.to === f.userId),
      onclick: () => { pick.to = f.userId; draw(); },
    }, h('span', { class: 'avatar' }, f.nickname.slice(0, 1)), f.nickname)));

    gridBox.replaceChildren(
      h('span', { class: 'slot-corner' }),
      ...grid.cols.map((c) => h('span', { class: `slot-head${c.weekend ? ' weekend' : ''}` }, h('b', {}, c.head), h('small', {}, c.sub))),
      ...['점심', '저녁'].flatMap((meal, mi) => [
        h('span', { class: 'slot-row' }, meal),
        ...grid.cols.map((c) => {
          const slot = c.slots[mi];
          const on = pick.keys.includes(slot.key);
          return h('button', {
            type: 'button', class: `slot${on ? ' on' : ''}${c.weekend ? ' weekend' : ''}`,
            disabled: slot.disabled, 'aria-pressed': String(on), 'aria-label': slot.short,
            onclick: () => toggleKey(slot.key),
          }, on ? String(pick.keys.indexOf(slot.key) + 1) : '');
        }),
      ]));
    nextWeekBtn.classList.toggle('on', pick.keys.includes(grid.nextWeek.key));

    picked.replaceChildren(...(pick.keys.length
      ? pick.keys.map((k, i) => h('span', { class: 'slot-tag' }, `${i + 1}. ${all.get(k).short}`))
      : [h('small', { class: 'muted' }, '3개까지 고를 수 있어요')]));

    quick.replaceChildren(...QUICK_NOTES.map((q) => h('button', {
      type: 'button', class: `chip${msg.value === q ? ' on-soft' : ''}`,
      onclick: () => { msg.value = msg.value === q ? '' : q; draw(); },
    }, q)));

    const to = friends.find((f) => f.userId === pick.to);
    const when = pick.keys.map((k) => all.get(k).short);
    preview.replaceChildren(
      h('span', { class: 'preview-label' }, to ? `${to.nickname}에게 이렇게 보여요` : '받는 화면 미리보기'),
      h('div', { class: 'preview-card' },
        h('span', { class: 'preview-tag' }, '같이 가자'),
        h('b', {}, myNick === '나' ? '내가 같이 가재요' : `${myNick}${josa(myNick, '이', '가')} 같이 가재요`),
        h('span', { class: 'preview-place' }, place, area ? h('small', {}, icon('pin', 14), area) : null),
        msg.value.trim() ? h('span', { class: 'preview-msg' }, `"${msg.value.trim()}"`) : null,
        h('span', { class: 'preview-when' }, icon('calendar', 16), when.length ? when.join(', ') : '날짜를 골라주세요')));

    send.textContent = to ? `${to.nickname}에게 보내기` : '누구랑 갈까요?';
    send.disabled = sending || !to || !pick.keys.length;
  };
  nextWeekBtn.addEventListener('click', () => toggleKey(grid.nextWeek.key));
  msg.addEventListener('input', draw);
  draw();

  const close = openModal(h('div', { class: 'invite-sheet' },
    h('h3', {}, '같이 가자'),
    h('div', { class: 'sheet-place' },
      photoEl({ place, photoUrl }, 'sheet-thumb'),
      h('div', {}, h('b', {}, place), h('small', {}, area ? icon('pin', 14) : null, [area, g.name].filter(Boolean).join(' · ')))),
    h('div', { class: 'row-label' }, '누구랑'), whoBox,
    h('div', { class: 'row-label' }, '언제'), gridBox, nextWeekBtn, picked,
    h('div', { class: 'row-label' }, '한마디'), quick, msg,
    preview, send,
    h('p', { class: 'sheet-foot' }, icon('lock', 16), '둘만 보여요')));

  send.addEventListener('click', async () => {
    if (sending || !pick.to || !pick.keys.length) return;
    sending = true;
    send.disabled = true;
    try {
      const choices = pick.keys.map((k) => ({ key: all.get(k).key, label: all.get(k).label }));
      const v = await state.store.sendInvite({ groupId, toUserId: pick.to, place, area, postId, message: msg.value.trim(), choices });
      state.invites = null;
      if (closeModal === close) {
        close();
        toast('보냈어요');
        go('t/' + encodeURIComponent(v.threadId));
      }

    } catch (e) {
      toast(e.message, 3500);
      sending = false;
      send.disabled = false;
    }
  });
}

const inviteReplyBusy = new Set();
async function respond(v, status, picked = null, note = '') {
  if (inviteReplyBusy.has(v.id)) return;
  const version = routeVersion;
  inviteReplyBusy.add(v.id);
  try {
    await state.store.respondInvite(v.id, status, picked, note);
    state.invites = null;
    if (version === routeVersion) {
      toast(status === 'yes' ? '약속 잡았어요' : status === 'other' ? '다른 날 물어봤어요' : '답했어요');
      route();
    }
  } catch (e) {
    toast(e.message, 3200);
  } finally { inviteReplyBusy.delete(v.id); }
}

// 초대 카드 사진: 초대한 글(또는 같은 모임의 같은 가게 글) 사진을 쓰고, 없으면 첫 글자 접시.
function invitePhoto(v, { tag = true } = {}) {
  const box = h('div', { class: `inv-photo${tag ? '' : ' thumb'}` });
  const show = (post) => box.replaceChildren(photoEl(post || { place: v.place }, 'inv-img'),
    ...(tag ? [h('span', { class: 'inv-tag' }, '같이 가자')] : []));
  show(null);
  // 피드와 저장소의 만료 갱신 캐시를 공유한다. URL만 따로 보관하면 만료 뒤에도 남는다.
  feedOf(v.groupId).then((posts) => {
    const key = normPlace(v.place);
    const hit = posts.find((p) => p.id === v.postId && p.photoUrl) || posts.find((p) => p.photoUrl && normPlace(p.place) === key);
    if (hit?.photoUrl) show(hit);
  }).catch(() => { /* 접시로 둔다 */ });
  return box;
}

// 카드 윗부분: 사진(같이 가자 알약) → 가게 이름 → 핀+동네 → 한마디
function inviteTop(v) {
  return [invitePhoto(v), h('h3', { class: 'inv-title' }, v.place),
    v.area ? h('p', { class: 'inv-area' }, icon('pin', 18), v.area) : null,
    v.message ? h('p', { class: 'inv-msg' }, `"${v.message}"`) : null];
}

const inviteWhen = (text) => h('p', { class: 'inv-when' }, icon('calendar', 20), h('span', {}, text));

// 상태 문구: 보낸 사람에게 패스는 "이번엔 어렵대요"(규칙 7), 받은 사람 본인에게는 "이번엔 패스했어요".
function inviteStateText(v, { withDate = true } = {}) {
  const sent = isMe(v.fromUserId);
  if (v.status === 'yes') return withDate ? `약속 잡혔어요 · ${choiceLabel(pickedChoice(v), today()) || v.picked}` : '약속 잡혔어요';
  if (v.status === 'pass' && !sent) return '이번엔 패스했어요';
  if (v.status === 'other' && !sent) return '다른 날 물어봤어요';
  if (v.status === 'pending' && !sent) return '아직 답하지 않았어요';
  return INVITE_STATUS[v.status] || '';
}
const INVITE_STATE_ICON = { pending: 'chat', yes: 'check-circle', other: 'calendar', pass: 'chat', cancelled: 'close' };

function receivedCard(v) {
  const choices = v.choices || [];
  const state1 = { picked: choices.length === 1 ? choices[0].label : null };
  const choiceBox = h('div', { class: 'chips inv-choices', role: 'group', 'aria-label': '날짜 고르기' });
  const drawChoices = () => choiceBox.replaceChildren(...choices.map((c) => h('button', {
    type: 'button', class: `chip toggle${state1.picked === c.label ? ' on' : ''}`, 'aria-pressed': String(state1.picked === c.label),
    onclick: () => { state1.picked = c.label; drawChoices(); },
  }, choiceLabel(c, today()))));
  drawChoices();
  const noteBox = h('div', { class: 'inv-note', hidden: true });
  const noteInput = h('input', { class: 'sheet-input', maxlength: 60, placeholder: '다른 날짜를 적어 주세요', 'aria-label': '다른 날짜 메모' });
  const noteSend = h('button', { class: 'btn small primary', type: 'button' }, '보내기');
  noteSend.addEventListener('click', () => respond(v, 'other', null, noteInput.value.trim()));
  noteBox.append(noteInput, noteSend);
  const otherBtn = h('button', { class: 'btn ghost inv-other', type: 'button', 'aria-expanded': 'false' }, '다른 날 어때?');
  otherBtn.addEventListener('click', () => {
    noteBox.hidden = !noteBox.hidden;
    otherBtn.setAttribute('aria-expanded', String(!noteBox.hidden));
    if (!noteBox.hidden) noteInput.focus();
  });
  return h('article', { class: 'bt-invite in' },
    ...inviteTop(v),
    choices.length === 1 ? inviteWhen(choiceLabel(choices[0], today()))
      : [inviteWhen('날짜를 골라 주세요'), choiceBox],
    h('div', { class: 'inv-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => respond(v, 'pass') }, '이번엔 패스'),
      h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => (state1.picked ? respond(v, 'yes', state1.picked) : toast('날짜 하나 골라주세요')),
      }, '좋아, 가자')),
    otherBtn, noteBox);
}

function appointmentCard(v) {
  const other = isMe(v.fromUserId) ? v.toUserId : v.fromUserId;
  const nick = nickOf(v.groupId, other);
  const c = pickedChoice(v);
  const date = /^(\d{4}-\d{2}-\d{2})\|/.exec(c?.key || '')?.[1] || '';
  return h('article', { class: 'invite-card appt', onclick: (e) => {
    if (!e.target.closest('a,button')) go(`t/${encodeURIComponent(v.threadId)}`);
  } },
    h('div', { class: 'inv-head' }, h('b', {}, c ? choiceLabel(c, today()) : v.picked || '날짜 미정'), nickLink(v.groupId, other, nick)),
    h('a', { class: 'inv-place', href: '#/t/' + encodeURIComponent(v.threadId) }, v.place, v.area ? h('span', { class: 'area' }, v.area) : null),
    h('div', { class: 'appt-actions' }, h('a', { class: 'btn small', href: '#/t/' + encodeURIComponent(v.threadId) }, '대화 보기'),
    h('a', {
      class: 'btn small primary',
      href: recordLink({ place: v.place, area: v.area, date: date && date <= today() ? date : '', withId: other }),
    }, '다녀와서 기록하기')));
}

// v1.7 채팅방·초대 모아보기는 아래 화면에서 렌더링한다.

// ---------------- 초대·설정 ----------------

async function statsSettingsCard() {
  const version = routeVersion;
  const optedOut = await state.store.getStatsOptOut();
  const toggle = h('input', { type: 'checkbox', role: 'switch', class: 'stats-switch',
    checked: !optedOut, 'aria-describedby': 'stats-help' });
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    try {
      await state.store.setStatsOptOut(!enabled);
      if (version === routeVersion) toast('통계 설정을 저장했어요');
    } catch {
      toggle.checked = !enabled;
      if (version === routeVersion) toast('설정을 저장하지 못했어요. 다시 해 주세요');
    } finally { toggle.disabled = false; }
  });
  return h('section', { class: 'card stats-settings' },
    h('label', { class: 'stats-setting-row' }, h('span', {}, '내 기록을 전체 통계에 익명으로 넣기'), toggle),
    h('p', { class: 'sub-line', id: 'stats-help' }, '숫자만 세요. 50명 넘을 때만 보여요'));
}

function accountDeletionCard() {
  if (!supports('deleteMyAccount')) return null;
  const panel = h('section', { class: 'card help', 'aria-label': '위험 구역', 'aria-live': 'polite' });
  const show = (step = 0, message = '') => {
    panel.replaceChildren(h('h2', { class: 'row-label' }, '위험 구역'));
    if (step === 0) {
      panel.append(h('button', { class: 'btn wide', type: 'button', onclick: () => show(1) }, '내 계정·기록 전부 지우기'));
      if (message) panel.append(h('p', { class: 'sub-line', role: 'status' }, message));
      return;
    }
    panel.append(h('p', {}, step === 1
      ? '모든 모임의 내 기록·사진·댓글·채팅·초대·리스트와 계정을 지워요. 되찾을 수 없어요.'
      : step === 3 ? '삭제 완료를 확인하지 못했어요. 다시 지우거나 삭제 준비를 취소해 주세요.'
        : '정말 전부 지울까요? 남은 친구의 모임은 유지되고, 나 혼자인 모임은 사라져요.'),
    h('p', { class: 'sub-line' }, step === 1 ? '체험 모드는 이 기기의 예시와 기록을 모두 지워요.' : '삭제 준비를 취소하면 계속 쓸 수 있어요. 이미 지운 사진은 복구되지 않아요.'));
    const cancel = h('button', { class: 'btn', type: 'button' }, step === 3 ? '삭제 준비 취소' : '취소');
    const action = h('button', { class: 'btn primary', type: 'button' }, step === 1 ? '삭제 내용 확인했어요' : step === 3 ? '다시 지우기' : '전부 지우고 탈퇴하기');
    const status = h('p', { class: 'sub-line', role: 'status' }, message);
    cancel.addEventListener('click', async () => {
      if (step !== 3) { show(0); return; }
      action.disabled = cancel.disabled = true;
      try {
        await state.store.cancelMyAccountDeletion();
        invalidate();
        show(0, '삭제 준비를 취소했어요. 이미 지운 사진은 복구되지 않아요.');
      } catch {
        status.textContent = '취소 여부를 확인하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.';
        action.disabled = cancel.disabled = false;
      }
    });
    action.addEventListener('click', async () => {
      if (step === 1) { show(2); return; }
      action.disabled = cancel.disabled = true;
      status.textContent = '사진과 기록을 지우고 있어요.';
      try {
        await state.store.deleteMyAccount();
        routeCleanup?.();
        routeCleanup = null;
        invalidate();
        state.groups = []; state.groupId = null; state.groupSeen = null;
        refreshGroupPills();
        document.querySelectorAll('.tab-badge').forEach((el) => el.remove());
        toast('계정과 기록을 지웠어요');
        go('start');
      } catch (e) {
        show(3, e.message || '연결을 확인한 뒤 다시 눌러 주세요.');
      }
    });
    panel.append(h('div', { class: 'btn-row' }, cancel, action), status);
    action.focus();
  };
  // 새로고침·화면 이동 후에도 서버에 남은 준비 상태에서 복구한다.
  if (supports('getMyAccountDeletion', 'cancelMyAccountDeletion')) {
    panel.append(h('p', { class: 'sub-line' }, '삭제 상태를 확인하고 있어요.'));
    state.store.getMyAccountDeletion().then((prepared) => show(prepared ? 3 : 0))
      .catch(() => show(3, '삭제 상태를 확인하지 못했어요.'));
  } else show();
  return panel;
}

async function chatBlockSettingsCard() {
  if (!supports('listChatBlocked', 'unblockChatUser', 'blockChatUser')) return null;
  const rows = await state.store.listChatBlocked();
  if (!rows.length) return null;
  return h('section', { class: 'card' }, h('h2', { class: 'row-label' }, '채팅 차단한 친구'),
    rows.map((b) => {
      const g = state.groups.find((x) => x.members.some((m) => m.userId === b.userId));
      return h('button', { class: 'btn wide', type: 'button', onclick: async () => {
        if (g) return openThreadInfo({ kind: 'dm', groupId: g.id, otherUserId: b.userId }, g, () => {}, true);
        try { await state.store.unblockChatUser(b.userId); toast('차단을 풀었어요'); route(); }
        catch (e) { toast(e.message); }
      } }, g ? `${nickOf(g.id, b.userId)} 차단 정보` : '모임을 나간 친구 차단 풀기');
    }));
}

async function renderGroup() {
  const version = routeVersion;
  const g = currentGroup();
  mount(loading());
  const statsSettings = await statsSettingsCard();
  const chatBlocks = await chatBlockSettingsCard();
  if (version !== routeVersion) return;
  if (!g) return mount(screenHeader({ back: 'me', title: '설정' }), h('h2', { class: 'set-label' }, '통계'), statsSettings,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => go('start?mode=create') }, '새 모임 만들기'),
      h('button', { class: 'btn', onclick: () => go('start?mode=join') }, '코드로 들어가기')), chatBlocks, accountDeletionCard());
  const t = today();
  let posts = [];
  try {
    posts = await feedOf(g.id);
  } catch {
    /* 오늘 올림 표시만 빠진다 */
  }
  const prog = todayProgress(g.members, posts, t);
  let blocked = [];
  try {
    blocked = await state.store.listBlocked();
  } catch {
    /* 목록만 빠진다 */
  }
  if (version !== routeVersion) return;
  const anyNick = (uid) => {
    for (const x of state.groups) {
      const m = x.members.find((y) => y.userId === uid);
      if (m) return m.nickname;
    }
    return '모임을 나간 친구';
  };

  const shareInvite = async () => {
    const text = inviteText(g);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    if (await copyText(text)) toast('복사했어요. 카톡에 붙여넣으면 돼요');
  };

  mount(
    screenHeader({ back: 'me', title: '설정' }),
    h('section', { class: 'set-group' },
      h('span', { class: 'set-eyebrow' }, '지금 모임'),
      h('h1', { class: 'set-group-name' }, g.name),
      h('a', { class: 'set-row', href: '#/members' }, icon('people', 22), h('span', {}, '모임 멤버'),
        h('small', {}, `${g.members.length}명`), icon('chevR', 18))),
    h('h2', { class: 'set-label' }, '친구 초대'),
    h('section', { class: 'card invite' },
      h('span', { class: 'row-label' }, '초대 코드'),
      h('div', { class: 'code' }, g.code),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: shareInvite }, icon('share', 18), ' 초대 보내기'),
        h('button', {
          class: 'btn',
          onclick: async () => { if (await copyText(inviteText(g))) toast('복사했어요'); },
        }, icon('copy', 18), ' 문구 복사')),
      h('pre', { class: 'invite-text' }, inviteText(g))),
    h('h2', { class: 'set-label' }, '오늘 올린 친구'),
    h('section', { class: 'card' },
      h('span', { class: 'row-label' }, `멤버 ${g.members.length}명`),
      h('ul', { class: 'member-list' }, prog.members.map((m) => h('li', { class: 'set-member' },
        h('a', { class: 'set-member-link', href: profileLink(g.id, m.userId) },
          h('span', { class: `avatar${m.done ? ' done' : ''}`, 'aria-hidden': 'true' }, m.nickname.slice(0, 1)),
          h('span', { class: 'set-member-name' }, m.nickname),
          h('span', { class: 'status' }, m.done ? [icon('check', 16), '오늘 올림'] : '')))))),
    h('h2', { class: 'set-label' }, '모임'),
    state.groups.length > 1
      ? h('section', { class: 'card' }, h('span', { class: 'row-label' }, '내 모임'),
        h('ul', { class: 'group-list' }, state.groups.map((x) => h('li', {},
          h('button', {
            class: `chip toggle${x.id === g.id ? ' on' : ''}`,
            onclick: () => { setGroup(x.id); go('settings'); },
          }, h('span', {}, x.name), h('small', {}, `${x.members.length}명`))))))
      : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => go('start?mode=create') }, '새 모임 만들기'),
      h('button', { class: 'btn', onclick: () => go('start?mode=join') }, '코드로 들어가기')),
    h('h2', { class: 'set-label' }, '통계'),
    statsSettings,
    chatBlocks,
    blocked.length
      ? h('section', { class: 'card' }, h('span', { class: 'row-label' }, '초대 안 받는 친구'),
        h('ul', { class: 'member-list' }, blocked.map((b) => h('li', {},
          h('b', {}, anyNick(b.userId)),
          h('button', {
            class: 'btn small', style: { marginLeft: 'auto' },
            onclick: async () => {
              try {
                await state.store.unblockInviter(b.userId);
                state.invites = null;
                toast('다시 초대를 받을 수 있어요');
                route();
              } catch (e) {
                toast(e.message);
              }
            },
          }, '되돌리기')))))
      : null,
    h('section', { class: 'card help' },
      h('span', { class: 'row-label' }, '앱처럼 쓰기'),
      h('p', {}, '아이폰은 Safari 공유 버튼에서 홈 화면에 추가'),
      h('p', {}, '안드로이드는 Chrome 메뉴에서 홈 화면에 추가'),
      h('p', {}, `폰이나 브라우저가 바뀌면: "초대 코드로 들어가기"에서 초대 코드 + 닉네임 '${g.myNickname}' + 내 4자리 번호`)),
    state.store.mode === 'demo'
      ? h('section', { class: 'card help' },
        h('span', { class: 'row-label' }, '체험 모드'),
        h('p', {}, '지금 보이는 건 예시예요.'),
        h('button', {
          class: 'btn small',
          onclick: async () => {
            if (!confirm('체험 데이터를 처음 상태로 되돌릴까요?')) return;
            await state.store.resetDemo();
            invalidate();
            await refreshGroups();
            toast('처음으로 돌렸어요');
            go('feed');
          },
        }, '체험 데이터 처음으로'))
      : null,
    accountDeletionCard(),
  );
}

// ---------------- 모임방·1:1방 ----------------

const threadLink = (id) => `#/t/${encodeURIComponent(id)}`;
const threadName = (t) => t.kind === 'group' ? groupName(t.groupId) : nickOf(t.groupId, t.otherUserId);

// 초대 모아보기 한 줄: 작은 사진 + 가게 + 누구·모임 + 상태(같은 카드 틀의 요약판)
function inviteSummaryRow(v) {
  const other = isMe(v.fromUserId) ? v.toUserId : v.fromUserId;
  return h('a', { class: 'bt-invite-row', href: threadLink(v.threadId) },
    invitePhoto(v, { tag: false }),
    h('span', { class: 'inv-row-body' },
      h('b', {}, v.place),
      h('small', {}, [nickOf(v.groupId, other), v.area, groupName(v.groupId)].filter(Boolean).join(' · ')),
      h('span', { class: `inv-row-state is-${v.status}` }, icon(INVITE_STATE_ICON[v.status] || 'chat', 16), inviteStateText(v))),
    icon('chevron-right', 20));
}

async function renderInvites() {
  const version = routeVersion;
  mount(loading());
  const invites = await loadInvites(true);
  if (version !== routeVersion) return;
  const received = invites.filter((v) => !isMe(v.fromUserId)).map(inviteSummaryRow);
  const sent = invites.filter((v) => isMe(v.fromUserId)).map(inviteSummaryRow);
  mount(screenHeader({ back: 'me', title: '초대 모아보기' }), h('div', { class: 'scr-invites' },
    h('h2', { class: 'inv-section' }, '받은 초대'),
    received.length ? h('div', { class: 'inv-rows' }, received) : h('p', { class: 'hint' }, '받은 초대가 없어요'),
    h('h2', { class: 'inv-section' }, '보낸 초대'),
    sent.length ? h('div', { class: 'inv-rows' }, sent) : h('p', { class: 'hint' }, '보낸 초대가 없어요'),
    h('p', { class: 'inv-private' }, icon('lock', 16), '초대는 두 사람만 볼 수 있어요')));
}

function openNewConversation() {
  const close = openModal(h('h3', {}, '새 대화'), h('div', { class: 'new-convo' }, ...state.groups.map((g) => h('section', {},
    h('h4', {}, g.name), h('div', { class: 'who-pick' }, g.members.filter((m) => !isMe(m.userId)).map((m) =>
      h('button', { class: 'who-chip', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          const thread = await state.store.openDm(g.id, m.userId);
          if (closeModal === close) { close(); go(`t/${encodeURIComponent(thread.id)}`); }
        } catch (err) { toast(err.message); }
        finally { btn.disabled = false; }
      } }, h('span', { class: 'avatar' }, m.nickname.slice(0, 1)), m.nickname)))))));
}

const firstLetter = (text) => Array.from(String(text || '').trim())[0] || '?';

// 대화방 얼굴: 단톡은 모임 첫 글자 코발트 원, 1:1은 친구 첫 글자 원
function threadFace(t, cls = '') {
  return h('span', { class: `avatar ${cls}${t.kind === 'group' ? ' group-face' : ''}`, 'aria-hidden': 'true' }, firstLetter(threadName(t)));
}

async function renderChats() {
  const version = routeVersion;
  const list = h('div', { class: 'thread-list' });
  const status = h('p', { class: 'hint', role: 'status' });
  mount(h('div', { class: 'scr-chats' },
    h('div', { class: 'chats-title' }, h('h1', { class: 'page-title' }, '채팅'),
      h('button', { class: 'btn small chats-new', type: 'button', onclick: openNewConversation }, icon('plus', 18), '새 대화')),
    currentGroup() ? groupPill() : null, status, list));
  let busy = false;
  const refresh = async () => {
    if (busy || version !== routeVersion) return;
    busy = true;
    try {
      const all = await state.store.listThreads();
      // 모임 단톡 먼저, 그다음 1:1방(각각 최근 대화 순 유지)
      const threads = [...all.filter((t) => t.kind === 'group'), ...all.filter((t) => t.kind !== 'group')];
      // 숨김 뒤 마지막으로 표시할 메시지를 찾는다. 방 인원과 안 읽은 수는 원래 집계를 쓴다.
      const previews = await Promise.all(threads.map(async (t) => {
        // 마지막 메시지에 번호가 없으므로 본문 목록에서 숨김을 적용한 뒤 고른다.
        const messages = await state.store.listMessages(t.id);
        const last = visibleItems('message', messages).at(-1);
        if (!last) return '표시할 대화가 없어요';
        if (last?.kind === 'invite') {
          const invite = (await loadInvites()).find((v) => v.id === last.inviteId);
          return `같이 가자 · ${invite?.place || '초대'}`;
        }
        if (last?.kind === 'poll') {
          const poll = (await state.store.listPolls(t.groupId)).find((p) => p.id === last.pollId);
          return `투표 · ${poll?.title || '모임 투표'}`;
        }
        return last.body;
      }));
      if (version !== routeVersion) return;
      list.replaceChildren(...(threads.length ? threads.map((t, i) => {
        const g = state.groups.find((x) => x.id === t.groupId);
        return h('a', { class: `thread-row${t.unread ? ' unread' : ''}`, href: threadLink(t.id) },
          threadFace(t, 'thread-avatar'),
          h('div', { class: 'thread-body' },
            h('div', { class: 'thread-name' }, h('b', {}, threadName(t)),
              t.kind === 'group' ? h('small', { class: 'thread-members' }, `${g?.members.length || 0}명`) : null),
            t.kind === 'group' ? null : h('span', { class: 'thread-group' }, groupName(t.groupId)),
            h('p', {}, previews[i])),
          h('div', { class: 'thread-meta' }, t.lastMessageAt ? h('time', { datetime: t.lastMessageAt },
            ymd(new Date(t.lastMessageAt)) === today() ? timeLabel(t.lastMessageAt) : dateLabel(ymd(new Date(t.lastMessageAt)), today())) : null,
          t.unread ? h('span', { class: 'chat-count', 'aria-label': `안 읽은 메시지 ${t.unread}개` }, t.unread > 99 ? '99+' : t.unread) : null));
      }) : [h('p', { class: 'empty' }, '모임에 들어가면 대화를 시작할 수 있어요')]));
      status.textContent = '';
      await refreshUnread();
    } catch { if (version === routeVersion) status.textContent = '대화 목록을 불러오지 못했어요'; }
    finally { busy = false; }
  };
  const interval = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
  onRouteLeave(() => clearInterval(interval));
  await refresh();
}

async function chooseInvitePlace(thread) {
  const g = state.groups.find((x) => x.id === thread.groupId);
  if (!g) return;
  const suggestions = h('div', { class: 'place-picks' });
  const status = h('p', { class: 'hint' }, '가게를 불러오고 있어요');
  const place = h('input', { class: 'sheet-input', maxlength: 40, required: true, placeholder: '가게 이름', 'aria-label': '가게 이름' });
  const area = h('input', { class: 'sheet-input', maxlength: 20, placeholder: '동네', 'aria-label': '동네' });
  const select = (row) => {
    if (closeModal !== close) return;
    close();
    openInviteSheet({ groupId: g.id, place: row.place, area: row.area, photoUrl: row.photoUrl, toUserId: thread.otherUserId });
  };
  const form = h('form', { class: 'place-direct' }, h('span', { class: 'row-label' }, '직접 적기'),
    h('div', { class: 'place-row' }, place, area), h('button', { class: 'btn primary wide', type: 'submit' }, '이 가게로 초대'));
  form.addEventListener('submit', (e) => { e.preventDefault(); if (place.value.trim()) select({ place: place.value.trim(), area: area.value.trim() }); });
  const close = openModal(h('div', { class: 'invite-place-sheet' }, h('h3', {}, '같이 갈 가게'), status, suggestions, form));
  try {
    const [posts, wants, mine] = await Promise.all([feedOf(g.id, addDays(today(), -RANK_DAYS)), myWants(), myPosts()]);
    if (closeModal !== close) return;
    const pool = new Map([...placeRanking(posts), ...wishlist(wants, mine).todo].map((row) => [normPlace(row.place), row]));
    suggestions.replaceChildren(...[...pool.values()].map((row) => h('button', { class: 'place-pick', type: 'button', onclick: () => select(row) },
      photoEl({ place: row.place, photoUrl: row.photoUrl }, 'place-pick-img'),
      h('span', { class: 'place-pick-body' }, h('b', {}, row.place), row.area ? h('small', {}, icon('pin', 14), row.area) : null),
      icon('chevron-right', 20))));
    status.textContent = pool.size ? '모임 맛집과 가고 싶은 곳이에요' : '가게 이름을 직접 적어 주세요';
  } catch { if (closeModal === close) status.textContent = '가게를 불러오지 못했어요. 직접 적을 수 있어요'; }
}

function threadInviteCard(v) {
  if (v.status === 'pending' && isMe(v.toUserId)) return receivedCard(v);
  const sent = isMe(v.fromUserId);
  const other = sent ? v.toUserId : v.fromUserId;
  const choice = pickedChoice(v);
  const date = /^(\d{4}-\d{2}-\d{2})\|/.exec(choice?.key || '')?.[1] || '';
  const when = v.status === 'yes' ? choiceLabel(choice, today()) || v.picked
    : (v.choices || []).map((c) => choiceLabel(c, today())).join(', ');
  // 상태 영역은 읽기 전용(누르는 곳 아님). 거절도 오류처럼 보이지 않게 같은 옅은 블루 칸.
  const card = h('article', { class: `bt-invite ${sent ? 'out' : 'in'} is-${v.status}` },
    ...inviteTop(v),
    when ? inviteWhen(when) : null,
    h('p', { class: 'inv-state' }, icon(INVITE_STATE_ICON[v.status] || 'chat', 22), h('span', {}, inviteStateText(v, { withDate: false }))),
    v.status === 'other' && v.replyNote ? h('p', { class: 'inv-reply' }, `"${v.replyNote}"`) : null,
    v.status === 'yes' ? h('a', { class: 'btn primary wide', href: recordLink({ place: v.place, area: v.area, date: date <= today() ? date : '', withId: other }) }, '다녀와서 기록하기') : null,
    v.status === 'other' && sent ? h('button', { class: 'btn wide', type: 'button', onclick: () => openInviteSheet({ groupId: v.groupId, place: v.place, area: v.area, postId: v.postId, toUserId: other }) }, '다른 날로 다시 보내기') : null);
  if (sent && v.status === 'pending') card.append(h('div', { class: 'inv-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => shareText(inviteShareText(v, v.groupId)) }, '카톡으로 알리기'),
    h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await state.store.cancelInvite(v.id); state.invites = null; route(); }
      catch (err) { toast(err.message); btn.disabled = false; }
    } }, '취소')));
  return card;
}

// 대화 정보(i): 모임·멤버, 같이 가자/투표 진입, 1:1은 "이 친구 초대 그만 받기"(상대에게 드러나지 않음)
async function openThreadInfo(thread, g, startAction, fromSettings = false) {
  const version = routeVersion;
  let chatBlocked = false;
  if (thread.kind === 'dm' && supports('listChatBlocked')) {
    try { chatBlocked = (await state.store.listChatBlocked()).some((b) => b.userId === thread.otherUserId); }
    catch (e) { toast(e.message); return; }
  }
  if (version !== routeVersion) return;
  const name = threadName(thread);
  const other = thread.otherUserId;
  const members = thread.kind === 'group' ? g.members : g.members.filter((m) => m.userId === other);
  const canAct = !fromSettings && (thread.kind === 'group' ? supports('listPolls', 'createPoll') : Boolean(other));
  openModal(h('div', { class: 'thread-info' },
    h('h3', {}, name),
    h('p', { class: 'sub-line' }, thread.kind === 'group' ? `모임 단톡 · ${g.members.length}명` : `${g.name} 친구`),
    h('ul', { class: 'member-list' }, visibleItems('member', members).map((m) => {
      const link = nickLink(g.id, m.userId, m.nickname);
      link.replaceChildren(h('span', { class: 'avatar', 'aria-hidden': 'true' }, firstLetter(m.nickname)), h('span', {}, m.nickname));
      return h('li', {}, link);
    })),
    canAct ? h('button', { class: 'btn primary wide', type: 'button', onclick: () => { closeModal?.(); startAction(); } },
      thread.kind === 'group' ? '투표 만들기' : '같이 가자 보내기') : null,
    thread.kind === 'dm' ? h('a', { class: 'btn wide', href: '#/invites' }, '초대 모아보기') : null,
    thread.kind === 'dm' && other && supports('blockChatUser', 'unblockChatUser') ? h('div', {},
      h('p', { class: 'sub-line' }, '차단하면 이 친구의 글과 댓글, 채팅 메시지와 1:1 대화가 내 화면에서 숨겨져요. 상대에게 알리지 않아요.'),
      h('button', { class: 'btn wide', type: 'button', onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          if (chatBlocked) await state.store.unblockChatUser(other);
          else await state.store.blockChatUser(other);
          state.invites = null;
          closeModal?.();
          toast(chatBlocked ? '차단을 풀었어요' : '이 친구를 차단했어요');
          go(fromSettings ? 'settings' : 'chats');
        } catch (e) { toast(e.message); button.disabled = false; }
      } }, chatBlocked ? '차단 풀기' : '이 친구 차단')) : null,
    thread.kind === 'dm' && other ? h('button', {
      class: 'link-btn', type: 'button',
      onclick: async () => {
        if (!confirm(`${name}의 초대를 그만 받을까요? 상대는 몰라요.`)) return;
        try {
          await state.store.blockInviter(other);
          state.invites = null;
          closeModal?.();
          toast('이제 안 보여요');
          route();
        } catch (e) {
          toast(e.message);
        }
      },
    }, '이 친구 초대 그만 받기') : null));
}

const WEEK_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
function chatDayLabel(day) {
  const d = parseYmd(day);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK_NAMES[d.getDay()]}요일`;
}

async function renderThread(threadId) {
  const version = routeVersion;
  mount(loading());
  const thread = (await state.store.listThreads()).find((t) => t.id === threadId);
  if (version !== routeVersion) return;
  if (!thread) return mount(screenHeader({ back: 'chats', title: '채팅' }), h('p', { class: 'empty' }, '대화방을 찾을 수 없어요'));
  setGroup(thread.groupId);
  const g = currentGroup();
  const isGroup = thread.kind === 'group';
  const list = h('div', { class: 'chat-messages', role: 'log', 'aria-label': '대화', 'aria-live': 'polite' });
  const quick = h('div', { class: 'chips chat-quick' });
  const input = h('input', { class: 'chat-input', maxlength: 300, placeholder: '메시지 보내기', 'aria-label': '메시지', enterkeyhint: 'send', autocomplete: 'off' });
  const send = h('button', { class: 'chat-round chat-send', type: 'submit', 'aria-label': '보내기' }, icon('send', 22));
  const startAction = () => (isGroup ? openPollSheet(g) : chooseInvitePlace(thread));
  const canAct = isGroup ? supports('listPolls', 'createPoll') : Boolean(thread.otherUserId);
  const plus = h('button', { class: 'chat-round chat-plus', type: 'button', disabled: !canAct,
    'aria-label': isGroup ? '투표 만들기' : '같이 가자 보내기', onclick: startAction }, icon('plus', 24));
  const status = h('p', { class: 'chat-status', role: 'status' });
  const form = h('form', { class: 'chat-form' }, plus, input, send);
  let active = true, refreshing = false, again = false, ready = false, signature = '';
  let unsubscribe = () => {}, interval;
  const disposeCards = () => list.querySelectorAll('.poll-card').forEach((card) => card.dispose?.());
  const draw = (messages, invites, polls) => {
    const shouldScroll = !ready || list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    const scrollTop = list.scrollTop;
    disposeCards();
    const nodes = [];
    let date = '', prev = null;
    for (const msg of visibleItems('message', messages)) {
      const day = ymd(new Date(msg.createdAt));
      if (day !== date) { nodes.push(h('div', { class: 'chat-date' }, chatDayLabel(day))); date = day; prev = null; }
      const more = moderationMenu({ groupId: thread.groupId, targetType: 'message', targetId: msg.id, targetUser: msg.senderId });
      if (msg.kind === 'system') { nodes.push(h('div', { class: 'chat-line' }, h('p', { class: 'chat-system' }, msg.body), more)); prev = null; continue; }
      const mine = isMe(msg.senderId);
      const time = h('time', { datetime: msg.createdAt }, timeLabel(msg.createdAt));
      if (['invite', 'poll'].includes(msg.kind)) {
        let content;
        if (msg.kind === 'invite') {
          const invite = invites.find((v) => v.id === msg.inviteId);
          content = invite ? threadInviteCard(invite) : h('p', { class: 'chat-system' }, '볼 수 없는 카드예요');
        } else {
          const poll = polls.find((p) => p.id === msg.pollId);
          content = poll ? pollCard(poll, { registerCleanup: false }) : h('p', { class: 'chat-system' }, '볼 수 없는 카드예요');
        }
        nodes.push(h('div', { class: `chat-line card-line${mine ? ' mine' : ''}` }, content, more));
        prev = null;
        continue;
      }
      const first = prev !== msg.senderId;
      prev = msg.senderId;
      const bubble = h('div', { class: `chat-bubble${msg.kind === 'invite_reply' ? ' reply-bubble' : ''}` }, h('p', {}, msg.body));
      if (mine) { nodes.push(h('div', { class: `chat-line mine${first ? ' first' : ''}` }, bubble, time)); continue; }
      const nick = nickOf(thread.groupId, msg.senderId);
      let author = null;
      if (first) {
        author = nickLink(thread.groupId, msg.senderId);
        author.classList.add('chat-author');
        author.setAttribute('aria-label', nick);
        author.replaceChildren(h('span', { class: 'avatar chat-avatar', 'aria-hidden': 'true' }, firstLetter(nick)),
          ...(isGroup ? [h('span', { class: 'chat-author-name' }, nick)] : []));
      }
      nodes.push(h('div', { class: `chat-line theirs${isGroup ? '' : ' direct'}${first ? ' first' : ''}` },
        author, h('div', { class: 'chat-stack' }, bubble, h('div', { class: 'message-tools' }, time, more))));
    }
    if (!isGroup && invites.length) nodes.push(h('p', { class: 'chat-private' }, '초대는 두 사람만 볼 수 있어요'));
    list.replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'hint' }, '아직 대화가 없어요')]));
    quick.replaceChildren(...(messages.length ? [] : ['오늘 뭐 먹어?', '이번 주 시간 돼?', '거기 어땠어?'].map((body) => h('button', {
      class: 'chip', type: 'button', onclick: () => { input.value = body; input.focus(); },
    }, body))));
    if (shouldScroll) list.scrollTop = list.scrollHeight;
    else list.scrollTop = scrollTop;
  };
  const refresh = async () => {
    if (!active) return;
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      do {
        again = false;
        const messages = await state.store.listMessages(threadId);
        if (!active) return;
        const [invites, polls] = await Promise.all([
          state.store.listInvites(messages.filter((m) => m.kind === 'invite' && m.inviteId).map((m) => m.inviteId)),
          thread.kind === 'group'
            ? state.store.listPolls(thread.groupId, messages.filter((m) => m.kind === 'poll' && m.pollId).map((m) => m.pollId)) : [],
        ]);
        if (!active) return;
        const relevant = invites.filter((v) => v.threadId === threadId);
        const nextSignature = JSON.stringify([messages, relevant, polls]);
        if (signature !== nextSignature) { draw(messages, relevant, polls); signature = nextSignature; }
        ready = true;
        status.textContent = '';
        const until = messages.at(-1)?.createdAt;
        if (document.visibilityState === 'visible' && until) {
          await state.store.markThreadRead(threadId, until);
          if (active) await refreshUnread();
        }
      } while (active && again);
    } catch { if (active) status.textContent = '대화를 새로 읽지 못했어요'; }
    finally { refreshing = false; }
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
  const cleanup = () => {
    active = false; unsubscribe(); clearInterval(interval); disposeCards();
    document.removeEventListener('visibilitychange', onVisibility);
  };
  onRouteLeave(cleanup);
  document.addEventListener('visibilitychange', onVisibility);
  // 목록 조회보다 먼저 구독한다. 도착 중인 메시지는 refresh의 다음 반복에서 읽는다.
  unsubscribe = state.store.subscribeThread(threadId, () => { if (active) { state.invites = null; refresh(); } });
  interval = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || send.disabled) return;
    send.disabled = true;
    try {
      await state.store.sendMessage(threadId, body);
      if (!active) return;
      if (input.value.trim() === body) input.value = '';
      list.scrollTop = list.scrollHeight;
      await refresh();
    } catch { if (active) status.textContent = '메시지를 보내지 못했어요'; }
    finally { send.disabled = false; }
  });
  const name = threadName(thread);
  const header = screenHeader({ back: 'chats', title: name, right: h('button', {
    type: 'button', class: 'icon-btn', 'aria-label': '대화 정보', onclick: () => openThreadInfo(thread, g, startAction),
  }, icon('info', 26)) });
  header.querySelector('.screen-header-title').replaceChildren(threadFace(thread, 'thread-head-avatar'), h('span', {}, name));
  mount(h('div', { class: 'scr-thread' }, header, h('section', { class: 'chat-page' },
    list, h('div', { class: 'chat-compose' }, quick, status, form))));
  await refresh();
}

// ---------------- 나·공개 미식가 ----------------

const namedLink = (handle) => `#/n/${encodeURIComponent(handle)}`;

async function renderMe() {
  const version = routeVersion;
  mount(loading());
  const [posts, profile] = await Promise.all([myPosts(), FEATURES.named ? state.store.myPublicProfile() : null]);
  const bowls = await bowlsSection(state.store.me());
  const challenges = [];
  let challengeError = false;
  try { challenges.push(...await personalChallenges()); } catch { challengeError = true; }
  if (currentGroup()) {
    try { challenges.push(...groupChallenges(await feedOf(state.groupId, `${monthOf(today())}-01`), state.groupId)); }
    catch { challengeError = true; }
  }
  if (version !== routeVersion) return;
  const g = currentGroup();
  const member = g?.members.find((m) => isMe(m.userId));
  const nickname = member?.nickname || '나';
  const taste = monthlyTaste(posts, monthOf(today()));
  const placeCount = new Set(posts.map((p) => normPlace(p.place)).filter(Boolean)).size;
  const recent = [...posts].sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4);
  const fold = (content, description) => {
    const heading = content?.querySelector('h2');
    if (!heading) return content;
    return h('details', { class: 'me-progress' },
      h('summary', {}, h('span', { class: 'me-progress-copy' }, heading,
        h('span', { class: 'me-progress-note' }, description)), icon('chevR', 18)), content);
  };
  const bowlKinds = bowls?.querySelectorAll('.bowl-row').length || 0;
  const completed = challenges.filter((c) => c.complete).length;
  const menu = (label, href) => h('a', { class: 'me-menu-row', href }, label, icon('chevR', 18));
  const stat = (label, value) => h('div', { class: 'me-stat' }, h('span', {}, label), h('b', {}, value));
  setTopRight(h('a', { class: 'icon-btn me-gear', href: '#/settings', 'aria-label': '설정' }, icon('gear', 26)));
  mount(h('div', { class: 'scr-me' },
    h('h1', { class: 'page-title me-title' }, '내 식탁'),
    h('section', { class: 'me-profile' },
      avatar(nickname, { size: 64 }),
      h('div', { class: 'me-profile-body' },
        h('div', { class: 'me-name-row' }, h('b', { class: 'me-name' }, nickname),
          taste.title ? h('span', { class: 'me-title-chip' }, taste.title) : null),
        member ? bioEditor(g, member) : h('p', { class: 'me-bio-empty' }, '모임을 만들어 친구와 기록해 보세요'))),
    h('div', { class: 'me-stats' }, stat('기록', posts.length), stat('가본 가게', placeCount), stat('모임', state.groups.length)),
    streakLine(streak(posts, state.store.me(), today())),
    h('section', { class: 'me-recent', 'aria-label': '최근 기록' },
      h('div', { class: 'me-section-head' }, h('h2', {}, '최근 기록'),
        posts.length ? h('a', { class: 'me-more', href: '#/records' }, '전체 보기', icon('chevR', 16)) : null),
      recent.length
        ? h('div', { class: 'me-grid' }, recent.map((p) => h('div', { class: 'me-tile' },
          p.photoUrl ? photoEl(p, 'me-tile-photo') : h('div', { class: 'me-tile-photo nophoto' }, plate(p.place, { size: 84 })),
          h('b', {}, p.place), h('small', {}, shortDay(p.eatenOn)))))
        : h('div', { class: 'rec-empty' }, h('p', {}, '아직 기록이 없어요'), h('a', { class: 'btn primary', href: '#/post' }, '첫 기록 남기기'))),
    h('nav', { class: 'me-menu', 'aria-label': '나의 메뉴' },
      menu('내 기록', '#/records'), menu('가고 싶은 곳', '#/records?filter=want'),
      menu('이달 리포트', '#/report'), menu('초대 모아보기', '#/invites'),
      menu('모임 설정', '#/settings'), menu('개인정보 처리방침', 'privacy.html'), menu('이용 규칙', 'terms.html')),
    fold(bowls, bowlKinds ? `${bowlKinds}종류의 기록 · 인증 단계 보기` : '첫 그릇을 기록해 보세요'),
    challenges.length ? fold(challengeCards(challenges), `진행 ${challenges.length - completed}개 · 완료 ${completed}개`) : null,
    challengeError ? h('p', { class: 'hint' }, '도전을 불러오지 못했어요') : null,
    FEATURES.named ? h('section', { class: 'card public-profile-card', id: 'publicProfile' },
      h('h2', {}, '공개 프로필'),
      profile ? h('a', { class: 'btn wide', href: namedLink(profile.handle) }, profile.displayName || profile.handle, icon('chevR', 18))
        : h('button', { class: 'btn primary', onclick: () => openPublicProfileSheet() }, '만들기'),
      h('p', { class: 'sub-line' }, '인증 배지는 확인된 미식가에게만 붙어요')) : null));
}

function openPublicProfileSheet(existing = null) {
  const handle = h('input', { class: 'sheet-input', value: existing?.handle || '', pattern: '[a-z0-9_]{3,20}',
    minlength: 3, maxlength: 20, required: true, autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
  handle.readOnly = Boolean(existing);
  const name = h('input', { class: 'sheet-input', value: existing?.displayName || currentGroup()?.myNickname || '', maxlength: 20, required: true });
  const bio = h('textarea', { class: 'sheet-input', maxlength: 80, rows: 2, value: existing?.bio || '' });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, '저장');
  const fields = h('fieldset', { class: 'poll-fields' },
    h('label', {}, '아이디', handle), h('p', { class: 'sub-line' }, existing ? '아이디는 바꿀 수 없어요' : '영문 소문자·숫자·밑줄 3~20자예요'),
    h('label', {}, '표시 이름', name), h('label', {}, '소개', bio));
  const form = h('form', {}, fields, submit);
  const close = openModal(h('h3', {}, '공개 프로필'), form);
  let active = true;
  modalCleanup = () => { active = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    fields.disabled = submit.disabled = true;
    try {
      await state.store.savePublicProfile({ handle: handle.value.trim(), displayName: name.value.trim(), bio: bio.value.trim() });
      if (active) { close(); toast('공개 프로필을 저장했어요'); route(); }
    } catch (err) {
      if (active) toast(err.message);
    } finally { fields.disabled = submit.disabled = false; }
  });
}

function verifiedBadge(profile) {
  return profile.verified ? h('span', { class: 'verified', 'aria-label': '인증된 미식가', title: '인증된 미식가' }, icon('check', 14)) : null;
}

function followButton(profile, onChange = () => {}) {
  if (isMe(profile.userId)) return null;
  const btn = h('button', { class: 'btn small', type: 'button' });
  const draw = () => {
    btn.textContent = profile.isFollowing ? '팔로잉' : '팔로우';
    btn.classList.toggle('primary', !profile.isFollowing);
    btn.setAttribute('aria-pressed', String(profile.isFollowing));
    btn.setAttribute('aria-label', `${profile.displayName} ${profile.isFollowing ? '팔로우 취소' : '팔로우'}`);
  };
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      if (profile.isFollowing) await state.store.unfollow(profile.userId);
      else await state.store.follow(profile.userId);
      profile.followers += profile.isFollowing ? -1 : 1;
      profile.isFollowing = !profile.isFollowing;
      draw(); onChange();
    } catch (e) { toast(e.message || '팔로우를 저장하지 못했어요'); }
    finally { btn.disabled = false; }
  });
  draw();
  return btn;
}

async function renderNamed(sort, following) {
  const version = routeVersion;
  sort = sort === 'new' ? 'new' : 'followers';
  mount(pageTitle('네임드'), tasteTabs('named'), loading());
  const [people, posts] = await Promise.all([state.store.listNamed({ sort }), following ? state.store.followingFeed() : []]);
  if (version !== routeVersion) return;
  const filters = h('div', { class: 'chips named-filters' },
    [['followers', '인기'], ['new', '새로운']].map(([key, label]) => h('button', {
      class: `chip toggle${!following && sort === key ? ' on' : ''}`, 'aria-pressed': String(!following && sort === key),
      onclick: () => go(`named?sort=${key}`),
    }, label)),
    h('button', { class: `chip toggle${following ? ' on' : ''}`, 'aria-pressed': String(following), onclick: () => go('named?following=1') }, '팔로잉'));
  const cards = following ? posts.map((p) => postCard(p, { publicOnly: true, showDate: true, publicProfile: people.find((n) => n.userId === p.userId) }))
    : people.map((p) => {
      const followers = h('small', {}, `팔로워 ${p.followers.toLocaleString('ko-KR')}명`);
      return h('article', { class: 'card named-public-card' },
        h('a', { class: 'named-info', href: namedLink(p.handle) },
          avatar(p.displayName, { size: 48 }),
          h('div', { class: 'named-body' }, h('b', {}, h('span', { class: 'named-name' }, p.displayName), verifiedBadge(p)),
            p.badge ? h('span', { class: 'badge' }, p.badge) : null, h('p', {}, p.bio), followers)),
        followButton(p, () => { followers.textContent = `팔로워 ${p.followers.toLocaleString('ko-KR')}명`; }));
    });
  mount(pageTitle('네임드'), tasteTabs('named'), filters,
    state.store.mode === 'demo' ? h('p', { class: 'sub-line' }, '체험용 가상 인물과 기록이에요') : null,
    cards.length ? cards : h('p', { class: 'empty named-empty' }, following ? '팔로우한 미식가의 공개 기록이 여기에 모여요' : '공개 미식가를 아직 찾지 못했어요'));
}

async function renderNamedProfile(handle) {
  const version = routeVersion;
  mount(loading());
  const { profile: p, posts } = await state.store.getNamed(handle);
  if (version !== routeVersion) return;
  if (!p) return mount(backButton('named'), h('p', { class: 'empty' }, '공개 프로필을 찾을 수 없어요'));
  const bowls = await bowlsSection(p.userId, true);
  if (version !== routeVersion) return;
  const followers = h('p', { class: 'sub-line' }, `팔로워 ${p.followers.toLocaleString('ko-KR')}명 · 공개 기록 ${p.postCount}개`);
  const counts = CATEGORIES.map((c) => ({ ...c, count: posts.filter((post) => post.category === c.key).length }))
    .filter((c) => c.count).sort((a, b) => b.count - a.count);
  mount(backButton('named'), h('section', { class: 'card profile-head named-head' },
    avatar(p.displayName, { size: 72 }),
    h('h1', { class: 'page-title' }, p.displayName, verifiedBadge(p)),
    p.badge ? h('span', { class: 'badge' }, p.badge) : null,
    h('p', { class: 'named-bio' }, p.bio), bowls, followers,
    followButton(p, () => { followers.textContent = `팔로워 ${p.followers.toLocaleString('ko-KR')}명 · 공개 기록 ${p.postCount}개`; }),
    isMe(p.userId) ? h('button', { class: 'btn small', onclick: () => openPublicProfileSheet(p) }, '프로필 고치기') : null),
  h('div', { class: 'chips category-chips', 'aria-label': '공개 기록 음식 종류' }, counts.map((c) => h('span', { class: 'chip' }, `${c.label} ${c.count}`))),
  h('h2', { class: 'day' }, '공개 기록'),
  posts.length ? posts.map((post) => h('div', {}, postCard(post, { publicOnly: true, publicProfile: p, showDate: true }),
    supports('expertRating') ? h('button', { class: 'btn small expert-open', onclick: () => openExpertSheet(post, posts) }, '이 가게 경험 평점') : null))
    : h('p', { class: 'empty' }, '아직 공개 기록이 없어요'));
}

async function openExpertSheet(post, posts) {
  if (!supports('expertRating')) return;
  const body = h('div', {}, loading());
  const close = openModal(h('h3', {}, post.place), body);
  const samePlace = posts.filter((p) => normPlace(p.place) === normPlace(post.place));
  const card = await expertCard(post.place, representativeCategory(samePlace));
  if (closeModal === close) body.replaceChildren(card || h('p', { class: 'hint' }, '평점을 모으고 있어요'));
}

// ---------------- 월간 리포트 ----------------

async function renderReport(ym) {
  const version = routeVersion;
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(ym) || ym > monthOf(today())) ym = monthOf(today());
  mount(loading());
  const posts = await state.store.myPostsInMonth(ym);
  const taste = monthlyTaste(posts, ym);
  const summary = monthSummary(posts, ym);
  let rankText = '';
  let rankFailed = false;
  if (taste.favorite) {
    try {
      const rank = await state.store.categoryRank(taste.favorite.key, ym);
      if (!rank.optedOut && Number.isFinite(rank.topPercent)) rankText = `한입 전체 상위 ${rank.topPercent}%`;
      else if (currentGroup()) {
        const groupPosts = await feedOf(state.groupId, `${ym}-01`);
        const counts = currentGroup().members.map((m) => ({ userId: m.userId,
          count: monthlyTaste(groupPosts.filter((p) => p.userId === m.userId), ym).counts[taste.favorite.key] }));
        const mine = counts.find((m) => isMe(m.userId))?.count || 0;
        rankText = mine ? `우리 모임에서 ${1 + counts.filter((m) => m.count > mine).length}등` : '모임에 공유한 이 종류 기록이 없어요';
      } else rankText = '순위를 매길 기록이 아직 부족해요';
    } catch { rankFailed = true; rankText = '순위를 불러오지 못했어요'; }
  }
  if (version !== routeVersion) return;
  const isDemo = state.store.mode === 'demo';
  // 머리줄: 뒤로 + 가운데 "‹ 9월 리포트 ›"(작은 꺾쇠로 달 이동, 이번 달 이후는 막음)
  const nav = h('div', { class: 'report-month-nav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '이전 달', onclick: () => go(`report?ym=${shiftMonth(ym, -1)}`) }, icon('chevL', 18)),
    h('h1', {}, `${monthLabel(ym)} 리포트`),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '다음 달', disabled: ym >= monthOf(today()), onclick: () => go(`report?ym=${shiftMonth(ym, 1)}`) }, icon('chevR', 18)));
  const header = screenHeader({ back: 'me', title: '' });
  header.querySelector('.screen-header-title').replaceWith(nav);
  if (!summary.total) {
    return mount(h('div', { class: 'scr-report' }, header, h('section', { class: 'report-empty' },
      h('p', { class: 'report-eyebrow' }, '나의 기록'),
      h('span', { class: 'report-empty-plate', 'aria-hidden': 'true' }),
      h('h2', {}, h('span', {}, '이번 달'), ' ', h('span', {}, '기록이 없어요')),
      h('p', { class: 'report-empty-sub' }, '한 끼부터 남겨보세요.'),
      h('a', { class: 'btn primary wide', href: '#/post' }, '한입 남기기'))));
  }
  const name = currentGroup()?.myNickname || '나';
  // 원형 접시에 담은 사진. 사진이 없으면 가게 첫 글자 접시(R11)
  const dish = (p, { lemon = '', size = 'big' } = {}) => {
    const body = p?.photoUrl
      ? h('span', { class: 'rp-dish' }, photoEl(p, 'rp-dish-photo'))
      : plate(p?.place || '', { size: size === 'big' ? 208 : 104 });
    return h('div', { class: `rp-dish-wrap ${size}${lemon ? ` lemon-${lemon}` : ''}` },
      lemon ? h('span', { class: 'rp-lemon', 'aria-hidden': 'true' }) : null, body);
  };
  const mv = summary.mostVisited;
  const repeat = mv.count > 1;
  // 표지 사진: 두 번 이상 간 가게가 있으면 그 가게, 아니면 추천을 가장 높게 준 가게
  const cover = repeat ? mv : (summary.bestRecommend || mv);
  const coverLine = summary.total === 1
    ? [h('p', { class: 'report-place' }, cover.place), cover.photoUrl ? null : h('p', { class: 'report-note' }, '사진 없는 기록')]
    : [h('p', { class: 'report-foot' }, `${repeat ? '가장 자주 간 가게' : '가장 높게 준 집'} · ${cover.place}`)];
  // 최애 음식 사진은 그 종류 기록의 사진만 쓴다(다른 가게 사진을 끼워 넣지 않는다)
  const favKey = taste.favorite.key;
  const kindOf = (p) => (Object.hasOwn(taste.counts, p.category) ? p.category : suggestCategory(`${p.place || ''} ${p.menu || ''}`));
  const favPost = posts.find((p) => p.photoUrl && String(p.eatenOn || '').startsWith(`${ym}-`) && kindOf(p) === favKey);
  const favDish = () => dish(favPost || { place: taste.favorite.label, photoUrl: null });
  const titleWords = (text) => String(text).split(' ').flatMap((w, i) => (i ? [' ', h('span', {}, w)] : [h('span', {}, w)]));
  const stage = h('section', { class: 'report-slide', tabindex: 0, 'aria-label': '월간 리포트 카드', 'aria-roledescription': '슬라이드' });
  const progress = h('div', { class: 'report-progress', role: 'group', 'aria-label': '리포트 진행' });
  const page = h('p', { class: 'report-page', 'aria-live': 'polite' });
  let index = 0;
  const share = h('button', { class: 'btn primary wide report-share', type: 'button' }, '공유 카드 저장');
  share.addEventListener('click', async (e) => {
    e.stopPropagation();
    share.disabled = true;
    try {
      const canvas = await drawReportCard({ name, summary: monthSummary(await originalPhotos(posts), ym), taste, rankText: rankFailed ? '' : rankText, demo: isDemo });
      if (version === routeVersion) await showCard(canvas, `hanip-report-${ym}.jpg`, `${monthLabel(ym)}의 한입`);
    } catch { toast('카드를 만들지 못했어요'); }
    finally { share.disabled = false; }
  });
  const award = (label, row, key, metric) => h('div', { class: 'report-award' },
    h('p', { class: 'report-award-label' }, label),
    h('h3', {}, row.place),
    h('div', { class: 'report-award-body' }, dish(row, { size: 'small' }),
      h('div', { class: 'report-award-text' },
        h('p', { class: 'report-award-score' }, icon('star', 26, { filled: true }), h('b', {}, fmt1(row[key]))),
        h('p', { class: 'report-award-metric' }, metric),
        h('p', { class: 'report-note' }, `이달 내 기록 ${row.count}개 기준`))));
  // 파란 카드(blue)와 흰 카드(white)를 시안 순서대로
  const slides = [
    ['blue', () => [h('p', { class: 'report-eyebrow' }, `${name}의 밥 기록`), h('h2', {}, `${monthLabel(ym)}의 한입`),
      h('p', { class: 'report-number' }, `${summary.total}끼`), h('p', { class: 'report-highlight' }, `${summary.placeCount}곳에서 먹었어요`),
      dish(cover, { lemon: 'low' }), ...coverLine]],
    ['white', () => [h('p', { class: 'report-eyebrow' }, '이번 달 최애 음식'), h('h2', {}, taste.favorite.label),
      h('p', { class: 'report-number' }, `${taste.favorite.count}그릇`), favDish(),
      h('p', { class: 'report-highlight' }, `내 기록 ${summary.total}끼 중`), h('p', { class: 'report-note' }, '내 기록 기준'),
      rankText ? h('p', { class: 'report-rank' }, rankText) : null,
      isDemo ? h('p', { class: 'report-caption' }, '체험용 예시 통계예요') : null]],
    ['blue', () => [h('p', { class: 'report-eyebrow' }, '이번 달의 칭호'),
      h('div', { class: 'report-title-ring' }, h('h2', {}, ...titleWords(taste.title || '다양하게 먹었어요'))),
      h('p', { class: 'report-highlight' }, taste.title ? `${taste.maniacs[0].label} ${taste.maniacs[0].count}그릇을 기록했어요` : '같은 종류를 3번 먹으면 마니아 칭호가 생겨요'),
      taste.maniacs.length > 1 ? h('div', { class: 'report-subtitles' }, taste.maniacs.slice(1).map((c) => h('div', { class: 'report-subtitle' },
        h('h3', {}, `${c.label} 마니아`), h('p', {}, `${c.label} ${c.count}그릇`)))) : null]],
    ['white', () => (repeat
      ? [h('p', { class: 'report-eyebrow' }, '가장 자주 간 가게'), h('h2', {}, mv.place), dish(mv),
        h('p', { class: 'report-number accent' }, `${mv.count}번`), h('p', { class: 'report-highlight' }, '다녀왔어요'),
        h('p', { class: 'report-note' }, '이달 내 기록 기준')]
      : [h('p', { class: 'report-eyebrow' }, '이번 달 탐험'), h('h2', {}, `${summary.placeCount}곳`),
        h('span', { class: 'report-empty-plate small', 'aria-hidden': 'true' }),
        h('p', { class: 'report-highlight' }, '매번 새로운 곳에 갔어요'), h('p', { class: 'report-note' }, '이달 내 기록 기준')])],
    ['white', () => [h('h2', { class: 'report-awards-title' }, '내가 높게 준 집'),
      award('추천', summary.bestRecommend, 'recommend', '추천'),
      award('가성비왕', summary.bestWorth, 'worth', '가성비')]],
    ['blue', () => [h('p', { class: 'report-eyebrow' }, `${monthLabel(ym)}의 한입`), h('h2', { class: 'report-final-title' }, taste.title || '나의 한 달'),
      h('p', { class: 'report-highlight' }, `${summary.total}끼 · ${summary.placeCount}곳`),
      dish(mv, { lemon: 'high' }), h('p', { class: 'report-note' }, '내 기록 기준'), share]],
  ];
  const prev = h('button', { class: 'btn', type: 'button', 'aria-label': '이전 카드', onclick: () => move(-1) }, '이전');
  const next = h('button', { class: 'btn primary', type: 'button', 'aria-label': '다음 카드', onclick: () => move(1) }, '다음');
  function draw() {
    const [tone, content] = slides[index];
    stage.className = `report-slide ${tone}`;
    stage.dataset.slide = String(index + 1);
    stage.replaceChildren(...content().flat().filter(Boolean));
    progress.replaceChildren(...slides.map((_, i) => h('button', {
      type: 'button', class: i <= index ? 'done' : '', 'aria-label': `${i + 1}번째 카드`, 'aria-current': i === index ? 'step' : null,
      onclick: () => { index = i; draw(); },
    })));
    page.textContent = `${index + 1} / ${slides.length}`;
    prev.disabled = index === 0; next.disabled = index === slides.length - 1;
  }
  function move(delta) { index = Math.max(0, Math.min(slides.length - 1, index + delta)); draw(); }
  let pointer = null;
  let swipedAt = 0;
  stage.addEventListener('pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener('pointerup', (e) => {
    if (!pointer) return;
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { swipedAt = Date.now(); move(dx < 0 ? 1 : -1); }
  });
  stage.addEventListener('pointercancel', () => { pointer = null; });
  stage.addEventListener('click', (e) => { if (!e.target.closest('button') && Date.now() - swipedAt > 400) move(1); });
  stage.addEventListener('keydown', (e) => {
    if (e.target.closest('button')) return;
    if (['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key)) { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); }
  });
  draw();
  mount(h('div', { class: 'scr-report' }, header, stage, progress, page, h('div', { class: 'report-controls' }, prev, next)));
}

boot();

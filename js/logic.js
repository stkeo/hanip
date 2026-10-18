// 순수 계산 모듈 — DOM·저장소를 모른다. tests/logic.test.mjs가 이 파일만 검증한다.

export const METRICS = [
  { key: 'taste', label: '맛' },
  { key: 'worth', label: '가성비' },
  { key: 'recommend', label: '추천' },
];

// 저장소 v1.7의 검증 키와 같은 순서. 모르는 음식은 기타로 기록한다.
export const CATEGORIES = [
  ['pyeongyang_naengmyeon', '평양냉면'], ['naengmyeon', '냉면'], ['gukbap', '국밥'],
  ['donkatsu', '돈까스'], ['ramen', '라멘'], ['sushi', '스시'], ['noodle', '면요리'],
  ['meat', '고기'], ['chicken', '치킨'], ['pizza_burger', '피자·버거'], ['pasta', '파스타'],
  ['chinese', '중식'], ['japanese', '일식'], ['korean', '한식'], ['western', '양식'],
  ['bunsik', '분식'], ['seafood', '해산물'], ['cafe', '카페'], ['bakery', '빵'],
  ['dessert', '디저트'], ['bar', '술집'], ['etc', '기타'],
].map(([key, label]) => ({ key, label }));

export function suggestCategory(text) {
  const value = String(text ?? '').replace(/\s+/g, '').toLowerCase();
  return [
    [/평양|평냉/, 'pyeongyang_naengmyeon'], [/냉면/, 'naengmyeon'],
    [/국밥|순대국|해장/, 'gukbap'], [/돈까스|돈카츠|돈가스|돈가츠/, 'donkatsu'],
    [/라멘/, 'ramen'], [/스시|초밥/, 'sushi'], [/베이글|빵|베이커리/, 'bakery'],
    [/파스타|스파게티/, 'pasta'], [/마라|짜장|짬뽕|중식|탕수육/, 'chinese'],
    [/칼국수|국수|우동|소바|라면/, 'noodle'], [/김밥|떡볶이|분식/, 'bunsik'],
    [/고기|삼겹|갈비|구이|스테이크/, 'meat'], [/치킨|통닭/, 'chicken'],
    [/피자|버거/, 'pizza_burger'], [/케이크|아이스크림|빙수|디저트|마카롱/, 'dessert'],
    [/카페|커피|라떼/, 'cafe'], [/횟집|해산물|조개|회정식|회덮밥/, 'seafood'],
    [/이자카야|술집|맥주|와인바|포차/, 'bar'], [/일식|덮밥|텐동/, 'japanese'],
    [/한식|백반|찌개|비빔밥/, 'korean'], [/양식|리조또/, 'western'],
  ].find(([pattern]) => pattern.test(value))?.[1] || 'etc';
}

// 인증 그릇만 단계에 사용한다. progress는 현재 단계에서 다음 단계까지의 0~1 비율.
export const BOWL_TIERS = Object.freeze([
  { min: 10, label: '입문' }, { min: 50, label: '마니아' },
  { min: 100, label: '고수' }, { min: 300, label: '장인' },
].map(Object.freeze));

export function bowlTier(n) {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const current = BOWL_TIERS.filter((tier) => count >= tier.min).at(-1);
  const next = BOWL_TIERS.find((tier) => count < tier.min) || null;
  return { label: current?.label || null, next,
    progress: next ? (count - (current?.min || 0)) / (next.min - (current?.min || 0)) : 1 };
}

export const CHALLENGES = Object.freeze([
  { id: 'summer-naengmyeon', title: '여름 평냉 10그릇', months: [6, 8], category: 'pyeongyang_naengmyeon', target: 10, unit: '그릇', metric: 'posts', scope: 'user' },
  { id: 'autumn-bakery', title: '가을 빵지순례', months: [9, 11], category: 'bakery', target: 5, unit: '곳', metric: 'places', scope: 'user' },
  { id: 'monthly-gukbap', title: '국밥 도장깨기', category: 'gukbap', target: 5, unit: '곳', metric: 'places', scope: 'user' },
  { id: 'new-areas', title: '새 동네 3곳', target: 3, unit: '곳', metric: 'areas', scope: 'user' },
  { id: 'group-meals', title: '모임 함께 20끼', target: 20, unit: '끼', metric: 'posts', scope: 'group' },
].map((c) => Object.freeze({ ...c, ...(c.months ? { months: Object.freeze(c.months) } : {}) })));

// eatenOn 기준, 미래 제외. 개인 도전은 본인 기록만, 모임 도전은 모임마다 따로 센다.
// groupId/groupIds가 없는 입력은 호출자가 한 모임으로 좁힌 기록으로 간주한다.
// 새 동네는 제공된 본인 전체 이력에서 이번 달에 처음 등장한 동네다.
export function challengeProgress(posts, userId, today) {
  const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date.slice(0, 4) !== '0000' && ymd(parseYmd(date)) === date;
  if (!validDate(today)) return [];
  const month = Number(today.slice(5, 7));
  const year = today.slice(0, 4);
  const seen = new Set();
  const all = (posts || []).filter((p) => {
    if (!p || !validDate(p.eatenOn) || p.eatenOn > today) return false;
    // 같은 글이 여러 모임에 공유돼도 각 모임에서 한 번만 센다.
    const key = p.id == null ? p : `${p.id}|${p.groupId || ''}|${[...(p.groupIds || [])].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const mine = all.filter((p) => p.userId === userId);
  const groups = new Map();
  for (const p of all) {
    const ids = p.groupId ? [p.groupId] : p.groupIds || [null];
    for (const id of new Set(ids)) {
      if (!groups.has(id)) groups.set(id, new Map());
      groups.get(id).set(p.id ?? p, p);
    }
  }
  if (!groups.size) groups.set(null, new Map());
  return CHALLENGES.flatMap((c) => {
    if (c.months && (month < c.months[0] || month > c.months[1])) return [];
    const start = c.months ? `${year}-${String(c.months[0]).padStart(2, '0')}-01` : `${monthOf(today)}-01`;
    const end = addDays(shiftMonth(c.months ? `${year}-${String(c.months[1]).padStart(2, '0')}` : monthOf(today), 1) + '-01', -1);
    const calculate = (source, groupId = null) => {
      const inPeriod = source.filter((p) => p.eatenOn >= start && (!c.category
        || (CATEGORIES.some((x) => x.key === p.category) ? p.category : suggestCategory(`${p.place || ''} ${p.menu || ''}`)) === c.category));
      let count = inPeriod.length;
      if (c.metric === 'places') count = new Set(inPeriod.map((p) => normPlace(p.place)).filter(Boolean)).size;
      if (c.metric === 'areas') {
        const previous = new Set(source.filter((p) => p.eatenOn < start).map((p) => normPlace(p.area)).filter(Boolean));
        count = new Set(inPeriod.map((p) => normPlace(p.area)).filter((area) => area && !previous.has(area))).size;
      }
      return { ...c, groupId, start, end, count, progress: Math.min(1, count / c.target), complete: count >= c.target };
    };
    if (c.scope === 'user') return [calculate([...new Map(mine.map((p) => [p.id ?? p, p])).values()])];
    return [...groups].map(([groupId, records]) => calculate([...records.values()], groupId));
  });
}

// posts는 한 사람의 기록. 명시한 종류를 우선하고 예전 기록만 키워드로 보완한다.
// 같은 수면 CATEGORIES 순서로 정하므로 입력 순서에 따라 최애가 바뀌지 않는다.
export function monthlyTaste(posts, ym) {
  const list = posts.filter((p) => String(p.eatenOn || '').startsWith(`${ym}-`));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  for (const p of list) {
    const key = Object.hasOwn(counts, p.category) ? p.category : suggestCategory(`${p.place || ''} ${p.menu || ''}`);
    counts[key] += 1;
  }
  const categories = CATEGORIES.map((c) => ({ ...c, count: counts[c.key] }))
    .filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const favorite = categories[0] || null;
  const maniacs = categories.filter((c) => c.count >= 3 && c.key !== 'etc');
  return { ym, total: list.length, counts, categories, favorite, maniacs,
    isManiac: Boolean(favorite && favorite.count >= 3 && favorite.key !== 'etc'),
    title: maniacs.length ? `${maniacs[0].label} 마니아` : null };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ---- 날짜 (기기 현지 시각 기준 'YYYY-MM-DD') ----

export function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function dateLabel(s, today) {
  if (s === today) return '오늘';
  if (s === addDays(today, -1)) return '어제';
  if (s === addDays(today, 1)) return '내일';
  return dateLabelLong(s);
}

export function dateLabelLong(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function monthOf(s) {
  return s.slice(0, 7);
}

export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  return `${Number(ym.slice(5, 7))}월`;
}

// ---- 가게 이름·평균 ----

export function normPlace(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

export function avg(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function fmt1(n) {
  return n == null ? '-' : (Math.round(n * 10) / 10).toFixed(1);
}

function averagesOf(posts) {
  return Object.fromEntries(METRICS.map((m) => [m.key, avg(posts.map((p) => p[m.key]))]));
}

// ---- 모임 식사 카드: 같은 날 같은 가게를 2명 이상이 올리면 한 장으로 묶는다 ----

export function detectMealCards(posts) {
  const buckets = new Map();
  for (const p of posts) {
    const key = `${p.eatenOn}|${normPlace(p.place)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  const cards = [];
  for (const [key, list] of buckets) {
    // 한 사람이 같은 가게를 두 번 올렸으면 최신 1건만 친다
    const byUser = new Map();
    for (const p of list) {
      const prev = byUser.get(p.userId);
      if (!prev || p.createdAt > prev.createdAt) byUser.set(p.userId, p);
    }
    if (byUser.size < 2) continue;
    const members = [...byUser.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    cards.push({
      key,
      eatenOn: members[0].eatenOn,
      place: members[0].place,
      placeKey: normPlace(members[0].place),
      posts: members,
      averages: averagesOf(members),
    });
  }
  return cards.sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.posts.length - a.posts.length);
}

// ---- 반응 (모임 안에서만 보임) ----

export const REACTIONS = [
  { kind: 'yum', emoji: '😋', label: '맛있겠다' },
  { kind: 'want', emoji: '🙋', label: '나도 갈래' },
  { kind: 'like', emoji: '👍', label: '인정' },
  { kind: 'lol', emoji: '😂', label: 'ㅋㅋ' },
];

export function reactionSummary(reactions, me) {
  const list = reactions || [];
  return Object.fromEntries(REACTIONS.map((r) => {
    const mine = list.filter((x) => x.kind === r.kind);
    return [r.kind, { count: mine.length, mine: mine.some((x) => x.userId === me), userIds: mine.map((x) => x.userId) }];
  }));
}

// 받침 따라 조사 고르기: josa('준호', '이', '가') → '가', josa('민지'...) → '가', josa('서연', '이', '가') → '이'
export function josa(word, withFinal, withoutFinal) {
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return withoutFinal; // 한글 아님(영문·숫자)은 받침 없음으로
  return code % 28 ? withFinal : withoutFinal;
}

export function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (n >= 10000) {
    const man = n / 10000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}만원`;
  }
  return `${n.toLocaleString('ko-KR')}원`;
}

// "3월 1일" 같은 입력 없이 숫자만 뽑는다: "1만 2천" 같은 건 안 받고 "12,000" "12000원"만
export function parsePrice(s) {
  const digits = String(s ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return n > 1000000 ? null : n;
}

// ---- 같이 먹었다고 태그됐는데 나는 아직 안 올린 식사 (같은 날·같은 가게 기준) ----

export function pendingTags(groupPosts, myPosts, me) {
  const done = new Set([...groupPosts, ...myPosts].filter((p) => p.userId === me)
    .map((p) => `${p.eatenOn}|${normPlace(p.place)}`));
  const seen = new Set();
  return groupPosts.filter((p) => {
    if (p.userId === me || !(p.withUserIds || []).includes(me)) return false;
    const k = `${p.eatenOn}|${normPlace(p.place)}`;
    if (done.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// posts는 feedOf(groupId)의 결과. 소속 정보가 있으면 한 번 더 모임을 좁힌다.
// 실제 저장소 피드는 groupIds가 빈 배열이므로 이때는 호출자의 모임 범위를 따른다.
export function groupAlertSummary({ threads = [], invites = [], posts = [], myPosts = [], me, groupId, seenAt, now } = {}) {
  const groupPosts = posts.filter((p) => p.groupId != null ? p.groupId === groupId
    : !p.groupIds?.length || p.groupIds.includes(groupId));
  const unread = threads.filter((t) => t.groupId === groupId).reduce((sum, t) => {
    const n = Number(t.unread);
    return sum + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  }, 0);
  const pendingInvites = invites.filter((v) => v.groupId === groupId && v.toUserId === me && v.status === 'pending').length;
  const requests = pendingTags(groupPosts, myPosts, me).length;
  const seenTime = typeof seenAt === 'string' ? Date.parse(seenAt) : NaN;
  const nowTime = typeof now === 'string' ? Date.parse(now) : Infinity;
  const newPosts = Number.isFinite(seenTime)
    ? groupPosts.filter((p) => p.userId !== me && Date.parse(p.createdAt) > seenTime && Date.parse(p.createdAt) <= nowTime).length : 0;
  return { unread, invites: pendingInvites, requests, newPosts, total: unread + pendingInvites + requests + newPosts };
}

// ---- 우리 모임 맛집 순위 ----

export const RANK_SORTS = [
  { key: 'recommend', label: '추천순' },
  { key: 'taste', label: '맛' },
  { key: 'worth', label: '가성비' },
  { key: 'count', label: '많이 간 순' },
];

export function placeRanking(posts, sortKey = 'recommend') {
  const groups = new Map();
  for (const p of posts) {
    const k = normPlace(p.place);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const rows = [...groups.entries()].map(([placeKey, ps]) => {
    const latest = [...ps].sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt));
    return {
      placeKey,
      place: latest[0].place,
      area: latest.find((p) => p.area)?.area || '',
      count: ps.length,
      visitors: new Set(ps.map((p) => p.userId)).size,
      ...averagesOf(ps),
      last: latest[0].eatenOn,
      photoUrl: latest.find((p) => p.photoUrl)?.photoUrl || null,
      posts: latest,
    };
  });
  const byKey = sortKey === 'count'
    ? (a, b) => b.count - a.count || b.recommend - a.recommend || b.last.localeCompare(a.last)
    : (a, b) => b[sortKey] - a[sortKey] || b.visitors - a.visitors || b.count - a.count || b.last.localeCompare(a.last);
  return rows.sort(byKey);
}

// ---- 가고 싶은 곳: '나도 갈래'를 누른 가게 − 누른 뒤에 내가 다녀와서 기록한 가게 ----

export function wishlist(wants, myPosts) {
  const latestWant = new Map();
  for (const w of wants) {
    const k = normPlace(w.place);
    const prev = latestWant.get(k);
    if (!prev || w.createdAt > prev.createdAt) latestWant.set(k, w);
  }
  const todo = [];
  const done = [];
  for (const [k, w] of latestWant) {
    const since = ymd(new Date(w.createdAt));
    const visit = myPosts.find((p) => normPlace(p.place) === k && p.eatenOn >= since);
    (visit ? done : todo).push({ ...w, placeKey: k, visitedOn: visit?.eatenOn || null });
  }
  const byNew = (a, b) => b.createdAt.localeCompare(a.createdAt);
  return { todo: todo.sort(byNew), done: done.sort(byNew) };
}

// 기록 날짜 기준. 같은 날 여러 끼는 하루로 세고 미래 기록은 제외한다.
export function streak(posts, userId, today) {
  const days = new Set(posts.filter((p) => p.userId === userId && p.eatenOn <= today).map((p) => p.eatenOn));
  let day = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

export function titlesFor(groupPosts, userId, today) {
  const posts = groupPosts.filter((p) => p.eatenOn <= today);
  const mine = posts.filter((p) => p.userId === userId);
  if (!mine.length) return [];
  const titles = [];
  const add = (key, label, desc) => titles.push({ key, label, desc });
  const monthCounts = new Map();
  for (const p of posts.filter((p) => monthOf(p.eatenOn) === monthOf(today))) {
    monthCounts.set(p.userId, (monthCounts.get(p.userId) || 0) + 1);
  }
  const count = monthCounts.get(userId) || 0;
  // 공동 1위도 같은 칭호를 받는다.
  if (count >= 3 && count === Math.max(...monthCounts.values())) add('foodie', '먹보', `이번 달 ${count}개 기록`);
  const worth = avg(mine.map((p) => p.worth));
  if (mine.length >= 3 && worth >= 4.3) add('value', '가성비 헌터', `가성비 평균 ${fmt1(worth)}`);
  const first = new Map();
  for (const p of [...posts].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)))) {
    const key = normPlace(p.place);
    if (key && !first.has(key)) first.set(key, p.userId);
  }
  const discoveries = [...first.values()].filter((id) => id === userId).length;
  if (discoveries >= 3) add('pioneer', '개척자', `처음 올린 가게 ${discoveries}곳`);
  const visits = new Map();
  for (const p of mine) {
    const key = normPlace(p.place);
    if (key) visits.set(key, (visits.get(key) || 0) + 1);
  }
  const most = Math.max(0, ...visits.values());
  if (most >= 3) add('regular', '단골', `한 가게에 ${most}번`);
  const wants = mine.reduce((n, p) => n + (p.reactions || []).filter((r) => r.kind === 'want').length, 0);
  if (wants >= 3) add('recommender', '추천 장인', `나도 갈래 ${wants}개`);
  const areas = new Set(mine.map((p) => (p.area || '').trim()).filter(Boolean));
  if (areas.size >= 4) add('explorer', '동네 탐험가', `다녀온 동네 ${areas.size}곳`);
  const scores = mine.map((p) => p.recommend).filter(Number.isFinite);
  const mean = avg(scores);
  const sd = Math.sqrt(avg(scores.map((s) => (s - mean) ** 2)) || 0);
  if (scores.length >= 5 && sd >= 1.2) add('critic', '냉정한 심사위원', `추천 편차 ${fmt1(sd)}`);
  const days = streak(mine, userId, today);
  if (days >= 3) add('streak', `${days}일 연속`, `${days}일 이어 썼어요`);
  return titles;
}

// placeRanking 행을 동네별로 묶는다. count는 방문 수가 아닌 가게 수다.
export function byArea(rows) {
  const areas = new Map();
  for (const row of rows) {
    const area = (row.area || '').trim();
    if (!area) continue;
    if (!areas.has(area)) areas.set(area, new Map());
    areas.get(area).set(normPlace(row.place), row);
  }
  return [...areas].map(([area, places]) => ({ area, count: places.size, rows: [...places.values()] }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area, 'ko'));
}

// 후보는 { place, recommend, wanted, ... }. 중복 가게는 한 번만 추첨한다.
export function pickPlace(pool, rand = Math.random) {
  const unique = new Map();
  for (const row of pool) {
    const key = normPlace(row?.place);
    if (!key) continue;
    const prev = unique.get(key);
    const recommend = Number.isFinite(row.recommend) ? Math.max(0, row.recommend) : 0;
    unique.set(key, { ...prev, ...row, recommend: Math.max(prev?.recommend || 0, recommend), wanted: Boolean(prev?.wanted || row.wanted) });
  }
  const candidates = [...unique.values()].map((row) => ({ row, weight: row.recommend + (row.wanted ? 1 : 0) })).filter((x) => x.weight > 0);
  if (!candidates.length) return null;
  const total = candidates.reduce((n, x) => n + x.weight, 0);
  const draw = rand();
  let cursor = (Number.isFinite(draw) ? Math.max(0, Math.min(draw, 1)) : 0) * total;
  for (const x of candidates) {
    cursor -= x.weight;
    if (cursor < 0) return x.row;
  }
  return candidates.at(-1).row;
}

// ---- 같이 가자 (1:1 초대) ----

export const INVITE_STATUS = {
  pending: '답 기다리는 중',
  yes: '약속 잡혔어요',
  other: '다른 날 어떠냐고 해요',
  pass: '이번엔 어렵대요',
  cancelled: '취소됐어요',
};

// 날짜 후보: 지금 시각 기준 가까운 끼니 + 이번 주말 + 다음 주.
// label은 저장용 절대 날짜("9월 26일 (금) 저녁") — '내일'은 받는 사람이 다음 날 열면 뜻이 바뀌기 때문.
// short는 보내는 순간 화면용 상대 표현("내일 저녁"). 나중에 다시 보여줄 땐 choiceLabel()로 계산한다.
export function timeOptions(now = new Date()) {
  const t = ymd(now);
  const opts = [];
  const add = (date, meal) => opts.push({
    key: `${date}|${meal}`, label: `${dateLabelLong(date)} ${meal}`, short: `${dateLabel(date, t)} ${meal}`,
  });
  if (now.getHours() < 16) add(t, '저녁');
  add(addDays(t, 1), '점심');
  add(addDays(t, 1), '저녁');
  // 이번 주말(토·일) — 오늘·내일과 겹치면 건너뜀
  for (let i = 2; i <= 7; i++) {
    const d = addDays(t, i);
    const wd = parseYmd(d).getDay();
    if (wd === 6 || wd === 0) {
      add(d, '점심');
      add(d, '저녁');
    }
    if (wd === 0) break;
  }
  opts.push({ key: 'next-week', label: '다음 주 아무 때나', short: '다음 주 아무 때나' });
  return opts;
}

// 보내기 창의 1주일 달력 칸: 오늘부터 days일 × 점심·저녁. 이미 지난 끼니는 disabled.
export const MEALS = ['점심', '저녁'];

export function slotGrid(now = new Date(), days = 7) {
  const t = ymd(now);
  const hour = now.getHours();
  const cols = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(t, i);
    const d = parseYmd(date);
    const wd = d.getDay();
    const head = i === 0 ? '오늘' : i === 1 ? '내일' : WEEKDAYS[wd];
    const sub = `${d.getMonth() + 1}/${d.getDate()}`;
    const dayWord = i < 2 ? head : `${WEEKDAYS[wd]}요일(${sub})`;
    cols.push({
      date, head, sub, weekend: wd === 0 || wd === 6,
      slots: MEALS.map((meal) => ({
        key: `${date}|${meal}`, label: `${dateLabelLong(date)} ${meal}`, short: `${dayWord} ${meal}`, meal,
        disabled: i === 0 && (meal === '점심' ? hour >= 13 : hour >= 20),
      })),
    });
  }
  return { cols, nextWeek: { key: 'next-week', label: '다음 주 아무 때나', short: '다음 주 아무 때나' } };
}

// 저장된 후보를 지금 기준으로 다시 읽기 쉽게: '2026-09-26|저녁' → '내일 저녁' / 지난 날짜면 절대 표기 그대로
export function choiceLabel(choice, today) {
  const m = /^(\d{4}-\d{2}-\d{2})\|(.+)$/.exec(choice?.key || '');
  if (!m) return choice?.label || '';
  return m[1] >= today ? `${dateLabel(m[1], today)} ${m[2]}` : choice.label;
}

export function inboxSummary(invites, me) {
  const list = invites || [];
  const received = list.filter((v) => v.toUserId === me && v.status === 'pending');
  const updates = list.filter((v) => v.fromUserId === me && v.status !== 'pending' && v.status !== 'cancelled' && !v.seenByFrom);
  return { received: received.length, updates: updates.length, total: received.length + updates.length };
}

// ---- 오늘 누가 올렸나 (전원 완료 표시용) ----

export function todayProgress(members, posts, today) {
  const posted = new Set(posts.filter((p) => p.eatenOn === today).map((p) => p.userId));
  const list = members.map((m) => ({ ...m, done: posted.has(m.userId) }));
  const done = list.filter((m) => m.done).length;
  return { total: list.length, done, members: list, everyone: list.length > 0 && done === list.length };
}

// ---- 월말 결산 (posts = 모임 또는 나의 글, ym = 'YYYY-MM') ----

export function monthSummary(posts, ym) {
  const list = posts.filter((p) => monthOf(p.eatenOn) === ym);
  const places = new Map();
  for (const p of list) {
    const k = normPlace(p.place);
    if (!places.has(k)) places.set(k, { place: p.place, posts: [] });
    places.get(k).posts.push(p);
  }
  const rows = [...places.values()].map(({ place, posts: ps }) => ({
    place,
    count: ps.length,
    ...averagesOf(ps),
    photoUrl: ps.find((p) => p.photoUrl)?.photoUrl || null,
    last: ps.map((p) => p.eatenOn).sort().at(-1),
  }));
  // 1위가 동점이면 이미 다른 상을 받은 가게는 양보한다(점수가 낮은 가게를 올리지는 않는다)
  const awarded = new Set();
  const top = (key) => {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => b[key] - a[key] || b.count - a.count || b.last.localeCompare(a.last));
    const ties = sorted.filter((r) => r[key] === sorted[0][key]);
    const pick = ties.find((r) => !awarded.has(r.place)) || sorted[0];
    awarded.add(pick.place);
    return pick;
  };
  const bestWorth = top('worth');
  const bestRecommend = top('recommend');
  const bestTaste = top('taste');

  const people = new Map();
  for (const p of list) {
    if (!people.has(p.userId)) people.set(p.userId, { userId: p.userId, nickname: p.nickname, count: 0 });
    people.get(p.userId).count += 1;
  }

  return {
    ym,
    total: list.length,
    placeCount: rows.length,
    mostVisited: rows.length
      ? [...rows].sort((a, b) => b.count - a.count || b.recommend - a.recommend || b.last.localeCompare(a.last))[0]
      : null,
    bestTaste,
    bestWorth,
    bestRecommend,
    mvp: [...people.values()].sort((a, b) => b.count - a.count)[0] || null,
    mealCount: detectMealCards(list).length,
    averages: averagesOf(list),
  };
}

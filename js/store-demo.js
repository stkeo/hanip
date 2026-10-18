// 체험 모드 저장소 — config.json이 비어 있으면 이걸 쓴다. 이 기기 localStorage에만 저장.
// 실제 모드(store-supabase.js)와 같은 모양의 함수를 내놓는다.
// v1.7: 모임·DM 채팅방, 음식 종류/상위 %, 가상 공개 미식가 체험.
// v1.8: 공개 태그 차단, 읽음 경계, 월별 기록과 채팅 카드 조회.
// v1.9: 익명 집계 예시 분포와 계정별 집계 제외.
// v2.0: 경험 인증·전문가 평점·리스트. 합성 수치는 demo 전용 필드로 분리한다.
// v2.1: 타인은 공개 기록만 집계하고 전문가 기준·기간 조회를 실제 저장소와 맞춘다.
import { addDays, ymd, timeOptions, normPlace } from './logic.js?v=202610181846';
import { blobToDataURL } from './image.js?v=202610181846';
import { uuid } from './util.js?v=202610181846';
import { reportInput } from './moderation.js?v=202610181846';

const KEY = 'hanip-demo-v5';
const ME = 'u-me';
// 기록한 본인까지 1,240명인 예시 분포. 식별자나 가짜 글을 만들지 않는다.
const DEMO_STATS_POPULATION = [
  { count: 1, users: 850 }, { count: 2, users: 265 }, { count: 3, users: 40 },
  { count: 4, users: 45 }, { count: 5, users: 25 }, { count: 6, users: 14 },
];
const REACTION_KINDS = ['yum', 'want', 'like', 'lol'];
const CATEGORIES = ['pyeongyang_naengmyeon', 'naengmyeon', 'gukbap', 'donkatsu', 'ramen', 'sushi',
  'noodle', 'meat', 'chicken', 'pizza_burger', 'pasta', 'chinese', 'japanese', 'korean', 'western',
  'bunsik', 'seafood', 'cafe', 'bakery', 'dessert', 'bar', 'etc'];
const INVITE_MESSAGES = {
  report_duplicate: '이미 신고한 대상이에요.',
  report_daily_limit: '신고는 하루 20건까지 할 수 있어요.',
  report_self: '자신은 신고할 수 없어요.',
  report_unavailable: '이 모임에서 확인할 수 있는 대상만 신고할 수 있어요.',
  post_daily_limit: '기록은 하루 20개까지 올릴 수 있어요.',
  account_deleting: '계정 삭제 준비 중이에요. 설정에서 다시 지우거나 취소해 주세요.',
  photo_daily_limit: '사진은 하루 20장까지 올릴 수 있어요.',
  photo_total_limit: '사진은 총 300장까지 보관할 수 있어요. 먼저 기록을 지워 주세요.',
  bad_chat_block: '같은 모임 친구만 차단할 수 있어요.',
  not_signed_in: '다시 시작해 주세요.',
  duplicate_receipt: '이미 쓴 영수증이에요.',
  duplicate_photo: '이미 올린 사진이에요.',
  daily_limit: '오늘은 이 종류를 더 인증할 수 없어요.',
  mismatch: '영수증이 이 기록과 안 맞아요.',
  bad_list: '리스트 내용을 다시 확인해 주세요.',
  not_owner: '본인 기록만 바꿀 수 있어요.',
  invite_self: '자기 자신에게는 보낼 수 없어요.',
  invite_not_member: '같은 모임 친구에게만 보낼 수 있어요.',
  invite_unavailable: '지금은 이 친구에게 보낼 수 없어요.',
  invite_duplicate: '이 친구에게 보낸 초대가 아직 답을 기다리고 있어요.',
  invite_cooldown: '이 친구는 얼마 전에 "이번엔 패스"라고 했어요. 7일 뒤에 다시 보낼 수 있어요.',
  invite_too_many: '답을 기다리는 초대가 너무 많아요. 몇 개를 정리한 뒤 보내 주세요.',
  invite_bad: '초대 내용을 다시 확인해 주세요.',
  invite_closed: '이미 답했거나 취소된 초대예요.',
  bad_message: '메시지는 1~300자로 보내 주세요.',
  thread_closed: '이 채팅방에는 보낼 수 없어요.',
  bad_read_until: '읽은 메시지 시각을 확인해 주세요.',
  bad_handle: '아이디는 영문 소문자·숫자·밑줄 3~20자예요.',
  handle_taken: '이미 있는 아이디예요.',
  handle_immutable: '아이디는 바꿀 수 없어요.',
  no_public_profile: '공개 프로필을 먼저 만들어 주세요.',
  bad_public_profile: '공개 이름은 1~20자, 소개는 80자까지 쓸 수 있어요.',
  bad_category: '음식 종류를 다시 골라 주세요.',
  bad_month: '월은 YYYY-MM 형식으로 골라 주세요.',
  bad_date_range: '조회할 날짜 범위를 다시 확인해 주세요.',
  bad_stats_opt_out: '통계 설정을 다시 확인해 주세요.',
  bad_follow: '팔로우할 공개 프로필을 다시 확인해 주세요.',
  bad_bio: '소개는 60자까지 쓸 수 있어요.',
  bad_poll: '투표 내용을 다시 확인해 주세요.',
  poll_closed: '이미 끝난 투표예요.',
  not_member: '참여 중인 모임에서만 사용할 수 있어요.',
};
function inviteError(code) {
  const error = new Error(INVITE_MESSAGES[code]);
  error.raw = code;
  return error;
}
const validText = (value, min, max) => typeof value === 'string' && [...value].length >= min && [...value].length <= max;
const inviteView = (invite) => ({ ...invite, choices: invite.choices.map(({ key, label }) => ({ key, label })) });

function pollInput(input) {
  const { title, options, closesAt = null } = input || {};
  if (!validText(typeof title === 'string' ? title.trim() : title, 1, 40) || !Array.isArray(options)
      || options.length < 2 || options.length > 6
      || options.some((o) => !o || !validText(typeof o.place === 'string' ? o.place.trim() : o.place, 1, 40)
        || !validText(o.area ?? '', 0, 20))
      || (closesAt !== null && (typeof closesAt !== 'string' || !Number.isFinite(Date.parse(closesAt))))) {
    throw inviteError('bad_poll');
  }
  return {
    title: title.trim(), options: options.map((o) => ({ place: o.place.trim(), area: (o.area ?? '').trim() })),
    closesAt: closesAt === null ? null : new Date(closesAt).toISOString(),
  };
}

function listInput(input) {
  const { id = null, groupId = null, isPublic = false, title, description = '', items } = input || {};
  if ((id !== null && !validText(id, 1, 100)) || (groupId !== null && !validText(groupId, 1, 100))
      || typeof isPublic !== 'boolean'
      || !validText(typeof title === 'string' ? title.trim() : title, 1, 30)
      || !validText(description, 0, 80) || !Array.isArray(items) || items.length < 1 || items.length > 20
      || items.some((item) => !item
        || !validText(typeof item.place === 'string' ? item.place.trim() : item.place, 1, Infinity)
        || typeof (item.area ?? '') !== 'string' || !validText(item.note ?? '', 0, 40))) {
    throw inviteError('bad_list');
  }
  return { id, groupId, isPublic, title: title.trim(), description: description.trim(),
    items: items.map((item) => ({ place: item.place.trim(), area: (item.area ?? '').trim(), note: (item.note ?? '').trim() })) };
}

// 잘못된 한쪽 추출값은 불일치로 처리하고, 다른 방법이 유효하면 인증할 수 있다.
function verificationInput(input = {}) {
  const { receiptHash, receiptStore, receiptDate, photoHash, aiCategory, aiConfidence } = input || {};
  const date = typeof receiptDate === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$/.test(receiptDate)
    && !receiptDate.startsWith('0000') && Number.isFinite(Date.parse(receiptDate))
    && new Date(receiptDate).toISOString().slice(0, 10) === receiptDate ? receiptDate : null;
  return {
    receiptHash: typeof receiptHash === 'string' ? receiptHash.trim() || null : null,
    receiptStore: validText(receiptStore, 1, 200) ? receiptStore : null, receiptDate: date,
    photoHash: typeof photoHash === 'string' ? photoHash.trim() || null : null,
    aiCategory: CATEGORIES.includes(aiCategory) ? aiCategory : null,
    aiConfidence: Number.isFinite(aiConfidence) && Math.abs(aiConfidence) <= 3.4028234663852886e38 ? aiConfidence : null,
  };
}


function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new Error('demo_storage_full');
  }
}

// 체험용 음식 사진: GPT 디자인 시안(BLUE TABLE) 그림에서 잘라낸 생성 이미지. 실제 가게·사용자 사진이 아니다.
const DEMO_PHOTOS = {
  'u-junho|골목 국밥집': 'demo/gukbap-hero.jpg',
  'u-minji|골목 국밥집': 'demo/gukbap-b.jpg',
  'u-seoyeon|베이글 공방': 'demo/bagel.jpg',
  [`${ME}|돈까스 연구소`]: 'demo/tonkatsu.jpg',
  'u-minji|동네 파스타': 'demo/pasta-cream.jpg',
  'u-seoyeon|동네 파스타': 'demo/pasta-truffle.jpg',
  'u-seoyeon|카페 소금빵': 'demo/cafe.jpg',
  'u-named-gukbap|느티 국밥': 'demo/gukbap-bowl.jpg',
};
// 나머지 예시 글은 사진 없는 글로 둔다(앱이 첫 글자 접시로 그린다 — 시안의 "사진 없는 기록"과 같은 모양).
const demoPhoto = (userId, place) => DEMO_PHOTOS[`${userId}|${place}`] ?? null;
const SEEDED_ME_PLACES = new Set(['편의점 김밥', '할머니 칼국수', '돈까스 연구소', '동네 면옥', '서촌 냉면', '을지 면가']);

// 예전 체험 데이터(이모지 그림)를 새 예시 사진·사진 없는 글로 바꾼다. 사용자가 체험 중 직접 올린 사진은 건드리지 않는다.
function upgradeDemoPhotos(db) {
  if (db.demoPhotos === 2) return db;
  const seeded = (p) => typeof p.photoData === 'string' && p.photoData.startsWith('data:image/jpeg') && p.photoData.length < 90000
    && (p.userId !== ME || SEEDED_ME_PLACES.has(p.place));
  const posts = db.posts.map((p) => {
    const photo = DEMO_PHOTOS[`${p.userId}|${p.place}`];
    if (photo && (seeded(p) || p.photoData === photo)) return { ...p, photoData: photo };
    return seeded(p) ? { ...p, photoData: null } : p;
  });
  return { ...db, posts, demoPhotos: 2 };
}

function seed() {
  const today = ymd(new Date());
  const at = (days, hour) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, (hour * 7) % 60, 0, 0);
    return d.toISOString();
  };
  const g1 = 'g-demo-1';
  const g2 = 'g-demo-2';
  const db = {
    groups: [
      { id: g1, name: '대학 동기 밥모임', code: 'DEMO24', createdAt: at(-20, 10) },
      { id: g2, name: '고등학교 친구들', code: 'HIGH07', createdAt: at(-10, 10) },
    ],
    members: [
      { groupId: g1, userId: ME, nickname: '나', bio: '' },
      { groupId: g1, userId: 'u-minji', nickname: '민지', bio: '국물 없으면 못 살아' },
      { groupId: g1, userId: 'u-junho', nickname: '준호', bio: '가성비 아니면 안 가' },
      { groupId: g1, userId: 'u-seoyeon', nickname: '서연', bio: '빵지순례 중' },
      { groupId: g2, userId: ME, nickname: '나', bio: '' },
      { groupId: g2, userId: 'u-jihoon', nickname: '지훈', bio: '' },
    ],
    posts: [],
    postGroups: [],
    reactions: [],
    comments: [],
    invites: [],
    inviteBlocks: [],
    threads: [],
    messages: [],
    threadReads: [],
    publicProfiles: [],
    follows: [],
    polls: [],
    pollsVotes: [],
    pins: {},
  };
  const rows = [
    // [일 차이, 시, 작성자, 가게, 동네, 맛, 가성비, 추천, 한 줄, 그림, 배경, 공유 모임, 메뉴?, 가격?, 동행?]
    [0, 12, 'u-junho', '골목 국밥집', '을지로', 5, 5, 5, '국물 미쳤음 무조건 또 감', '🍲', '#F6D7B0', [g1], '순대국', 9000],
    [0, 12, 'u-minji', '골목 국밥집', '을지로', 4, 5, 4, '깍두기가 진짜 맛있음', '🍲', '#F3CBA5', [g1], '순대국', 9000],
    [0, 15, 'u-seoyeon', '베이글 공방', '성수', 4, 2, 3, '맛있는데 좀 비쌈', '🥯', '#EFD9C1', [g1], '소금 베이글+라떼', 12500],
    [-1, 19, ME, '돈까스 연구소', '논현', 5, 4, 5, '등심 두께 실화냐', '🍱', '#F4DDB8', [g1, g2], '등심 돈까스', 13000],
    [-1, 20, 'u-junho', '마라 한 그릇', '신림', 3, 4, 3, '맵기 2단계면 충분', '🌶️', '#F7C6B5', [g1], '', null, [ME]],
    [-2, 13, 'u-minji', '동네 파스타', '망원', 4, 3, 4, '', '🍝', '#F5E0B9', [g1]],
    [-2, 13, 'u-seoyeon', '동네 파스타', '망원', 5, 3, 5, '트러플 크림 강추', '🍝', '#F2D6AF', [g1]],
    [-2, 22, ME, '편의점 김밥', '', 2, 5, 2, '배고파서…', '🍙', '#E9E4D4', []],
    [-4, 12, 'u-junho', '할머니 칼국수', '종로', 3, 5, 4, '양 엄청 많음', '🍜', '#F4E1C0', [g1]],
    [-4, 12, ME, '할머니 칼국수', '종로', 4, 5, 4, '겉절이 리필 무한', '🍜', '#F1DCB6', [g1]],
    [-6, 16, 'u-seoyeon', '카페 소금빵', '연남', 5, 3, 4, '', '🥐', '#F6E6C8', [g1]],
    [-3, 18, 'u-jihoon', '숯불 닭갈비', '춘천', 5, 4, 5, '막국수까지 완벽', '🍗', '#F5CFAE', [g2]],
  ];
  for (const [d, hr, u, place, area, t, w, r, note, emoji, bg, groups, menu = '', price = null, withUserIds = []] of rows) {
    const id = uuid();
    db.posts.push({
      id, userId: u, place, area, taste: t, worth: w, recommend: r, note,
      menu, price, withUserIds,
      photoData: demoPhoto(u, place), eatenOn: addDays(today, d), createdAt: at(d, hr),
    });
    for (const gid of groups) db.postGroups.push({ postId: id, groupId: gid });
  }
  const reactions = [
    [g1, 0, 'u-minji', 'yum', 0, 13],
    [g1, 0, 'u-seoyeon', 'want', 0, 14],
    [g1, 0, ME, 'want', 0, 15],
    [g1, 2, ME, 'want', 0, 16],
    [g1, 3, 'u-junho', 'yum', -1, 21],
    [g2, 3, 'u-jihoon', 'like', -1, 22],
    [g1, 4, ME, 'lol', -1, 21],
    [g1, 5, 'u-junho', 'want', -2, 18],
    [g1, 6, 'u-minji', 'like', -2, 19],
  ];
  for (const [groupId, index, userId, kind, d, hr] of reactions) {
    db.reactions.push({ groupId, postId: db.posts[index].id, userId, kind, createdAt: at(d, hr) });
  }
  const comments = [
    [g1, 0, 'u-minji', '여기 깍두기 인정', 0, 13],
    [g1, 0, ME, '다음에 나도 데려가', 0, 14],
    [g1, 2, 'u-junho', '베이글 한 입만', 0, 16],
    [g1, 3, 'u-seoyeon', '돈까스 두께 봐', -1, 21],
    [g2, 3, 'u-jihoon', '주말에 같이 가자', -1, 22],
  ];
  for (const [groupId, index, userId, body, d, hr] of comments) {
    db.comments.push({ id: uuid(), groupId, postId: db.posts[index].id, userId, body, createdAt: at(d, hr) });
  }
  // 실제 앱과 같은 형식(날짜|끼니)으로: 이번 주말 점심·저녁 후보 두 개
  const opts = timeOptions(new Date()).filter((o) => o.key !== 'next-week');
  const weekend = opts.filter((o) => /\((토|일)\)/.test(o.label));
  const choices = (weekend.length >= 2 ? [weekend[0], weekend.at(-1)] : opts.slice(0, 2))
    .map(({ key, label }) => ({ key, label }));
  db.invites = [
    {
      id: uuid(), groupId: g1, fromUserId: 'u-minji', toUserId: ME,
      place: '동네 파스타', area: '망원', postId: db.posts[5].id, message: '트러플 크림 먹으러 가자',
      choices, status: 'pending', picked: null, replyNote: '', createdAt: at(-1, 18),
      respondedAt: null, seenByFrom: false,
    },
    {
      id: uuid(), groupId: g1, fromUserId: ME, toUserId: 'u-junho',
      place: '골목 국밥집', area: '을지로', postId: null, message: '국밥 같이 먹자',
      choices, status: 'yes', picked: choices[0].label, replyNote: '좋아!', createdAt: at(-2, 11),
      respondedAt: at(-1, 12), seenByFrom: false,
    },
    {
      id: uuid(), groupId: g1, fromUserId: 'u-seoyeon', toUserId: ME,
      place: '카페 소금빵', area: '연남', postId: null, message: '',
      choices, status: 'pass', picked: null, replyNote: '그날은 약속이 있어', createdAt: at(-20, 10),
      respondedAt: at(-19, 12), seenByFrom: true,
    },
  ].map(inviteView);
  const pollId = uuid();
  db.polls.push({
    id: pollId, groupId: g1, creatorId: 'u-minji', title: '이번 주 금요일 어디 갈까?',
    options: [0, 2, 5].map((i) => ({ place: db.posts[i].place, area: db.posts[i].area })),
    closesAt: null, closed: false, createdAt: at(-1, 17),
  });
  db.pollsVotes.push(
    { pollId, userId: 'u-minji', optionIdx: 2, createdAt: at(-1, 18) },
    { pollId, userId: 'u-junho', optionIdx: 0, createdAt: at(-1, 19) },
  );
  db.demoPhotos = 2;
  return upgradeSafetyData(upgradeV20(upgradeV17(db)));
}

// 같은 키를 유지하여 v1.6의 사용자 기록·초대·채팅을 지우지 않고 이관한다.
function ensureThread(db, groupId, kind, a = null, b = null) {
  const [userA, userB] = kind === 'dm' ? [a, b].sort() : [null, null];
  let thread = db.threads.find((t) => t.groupId === groupId && t.kind === kind
    && (kind === 'group' || (t.userA === userA && t.userB === userB)));
  if (!thread) {
    thread = { id: uuid(), groupId, kind, userA, userB, createdAt: new Date().toISOString(), lastMessageAt: null };
    db.threads.push(thread);
  }
  return thread;
}
function messageRecord(threadId, senderId, kind, body = '', extra = {}) {
  return { id: uuid(), threadId, senderId, kind, body, inviteId: null, pollId: null,
    createdAt: new Date().toISOString(), ...extra };
}
function withMessages(db, messages) {
  return { ...db, messages: [...db.messages, ...messages], threads: db.threads.map((t) => {
    const last = messages.filter((m) => m.threadId === t.id).map((m) => m.createdAt).sort().at(-1);
    return last ? { ...t, lastMessageAt: !t.lastMessageAt || last > t.lastMessageAt ? last : t.lastMessageAt } : t;
  }) };
}
function guessCategory(place) {
  return [
    [/평양|면옥|냉면|면가/, 'pyeongyang_naengmyeon'], [/국밥/, 'gukbap'], [/돈까스/, 'donkatsu'],
    [/파스타/, 'pasta'], [/베이글|소금빵/, 'bakery'], [/마라/, 'chinese'], [/칼국수/, 'noodle'],
    [/김밥/, 'bunsik'], [/닭갈비/, 'meat'],
  ].find(([pattern]) => pattern.test(place))?.[1] ?? null;
}
function upgradeV17(db) {
  if (db.version === 7) return db;
  db.threads ??= []; db.messages ??= []; db.threadReads ??= [];
  db.publicProfiles ??= []; db.follows ??= [];
  db.invites ??= []; db.inviteBlocks ??= []; db.polls ??= []; db.pollsVotes ??= [];
  db.reactions ??= []; db.comments ??= [];
  db.posts = db.posts.map((p) => ({ ...p, category: p.category ?? guessCategory(p.place), isPublic: p.isPublic === true }));
  for (const group of db.groups) {
    const thread = ensureThread(db, group.id, 'group');
    thread.createdAt = group.createdAt;
  }
  for (const invite of db.invites) {
    const thread = ensureThread(db, invite.groupId, 'dm', invite.fromUserId, invite.toUserId);
    thread.createdAt = [thread.createdAt, invite.createdAt].sort()[0];
    invite.threadId = thread.id;
    if (!db.messages.some((m) => m.kind === 'invite' && m.inviteId === invite.id)) {
      db.messages.push(messageRecord(thread.id, invite.fromUserId, 'invite', '',
        { inviteId: invite.id, createdAt: invite.createdAt }));
    }
    if (['yes', 'other', 'pass'].includes(invite.status)
        && !db.messages.some((m) => m.kind === 'invite_reply' && m.inviteId === invite.id)) {
      const body = invite.status === 'yes' ? `좋아! ${invite.picked || ''}`
        : invite.status === 'other' ? `다른 날 어때? ${invite.replyNote || ''}` : '이번엔 어려워';
      db.messages.push(messageRecord(thread.id, invite.toUserId, 'invite_reply', body,
        { inviteId: invite.id, createdAt: invite.respondedAt || invite.createdAt }));
    }
  }
  for (const m of db.inviteMessages || []) {
    const invite = db.invites.find((i) => i.id === m.inviteId);
    if (invite && !db.messages.some((x) => x.id === m.id)) {
      db.messages.push(messageRecord(invite.threadId, m.senderId, 'text', m.body, { id: m.id, createdAt: m.createdAt }));
    }
  }
  for (const r of db.inviteReads || []) {
    const invite = db.invites.find((i) => i.id === r.inviteId);
    if (!invite) continue;
    const prior = db.threadReads.find((x) => x.threadId === invite.threadId && x.userId === r.userId);
    if (prior) prior.lastReadAt = [prior.lastReadAt, r.lastReadAt].sort()[0];
    else db.threadReads.push({ threadId: invite.threadId, userId: r.userId, lastReadAt: r.lastReadAt });
  }
  delete db.inviteMessages; delete db.inviteReads;
  for (const poll of db.polls) {
    const thread = ensureThread(db, poll.groupId, 'group');
    if (!db.messages.some((m) => m.kind === 'poll' && m.pollId === poll.id)) {
      db.messages.push(messageRecord(thread.id, poll.creatorId, 'poll', '', { pollId: poll.id, createdAt: poll.createdAt }));
    }
  }
  const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const college = db.groups.find((g) => g.id === 'g-demo-1');
  if (college) {
    const groupThread = ensureThread(db, college.id, 'group');
    for (const [senderId, body, minutes] of [
      ['u-junho', '오늘 국밥 ㄱ?', 55], ['u-minji', '난 파스타 땡기는데 ㅋㅋ', 52],
      [ME, '일단 투표부터 하자', 50], ['u-seoyeon', '밥 먹고 빵도 먹자', 48],
      ['u-junho', 'ㅇㅋ 다수결로 가자', 46],
    ]) db.messages.push(messageRecord(groupThread.id, senderId, 'text', body, { createdAt: ago(minutes) }));
    for (const [other, lines] of [
      ['u-minji', [[ME, '거기 크림 파스타 맛있어?'], ['u-minji', '응 ㅋㅋ 같이 가자']]],
      ['u-junho', [[ME, '깍두기도 맛있다던데'], ['u-junho', 'ㅇㅇ 국물까지 싹 먹자']]],
    ]) {
      const thread = ensureThread(db, college.id, 'dm', ME, other);
      lines.forEach(([sender, body], index) => db.messages.push(
        messageRecord(thread.id, sender, 'text', body, { createdAt: ago(30 - index * 2) })));
    }
  }
  // 이번 달 초에도 지난달로 넘어가지 않는 가상 평양냉면 기록 세 그릇.
  const today = ymd(new Date());
  for (const [index, place] of ['동네 면옥', '서촌 냉면', '을지 면가'].entries()) {
    const day = Math.max(1, new Date().getDate() - (index + 1) * 3);
    const eatenOn = today.slice(0, 8) + String(day).padStart(2, '0');
    const id = uuid();
    db.posts.push({
      id, userId: ME, place, area: ['동네', '서촌', '을지로'][index], taste: 5, worth: 4, recommend: 5,
      note: ['슴슴한 육수 또 생각남', '면 향이 좋아서 완냉', '이번 달 세 번째 평냉'][index],
      menu: '평양냉면', price: 13000 + index * 1000, withUserIds: [], category: 'pyeongyang_naengmyeon',
      isPublic: false, photoData: null, eatenOn,
      createdAt: new Date(eatenOn + 'T12:00:00+09:00').toISOString(),
    });
    if (college) db.postGroups.push({ postId: id, groupId: college.id });
  }
  // 아래 네 인물·가게·팔로워 수는 모두 시연용 가상 데이터다.
  const named = [
    ['u-named-naeng', 'naengmyeon_alert', '냉면주의보', '평냉만 300그릇째', true, '평양냉면 전문', 4820,
      'pyeongyang_naengmyeon', '🍜', '#DDEADB', ['구름 면옥', '새벽 냉면방', '달빛 면가', '여울 면옥', '은빛 냉면']],
    ['u-named-gukbap', 'gukbap_road', '국밥로드', '뜨끈한 한 그릇 찾아 걷는 중', true, '국밥 순례', 3160,
      'gukbap', '🍲', '#F6D7B0', ['느티 국밥', '골목끝 탕집', '포근 국밥', '노을 국밥', '한솥길 국밥']],
    ['u-named-bread', 'bread_pilgrim', '빵지순례자', '주말마다 새로운 빵집 한 곳', false, null, 1780,
      'bakery', '🥐', '#F6E6C8', ['구름결 빵집', '오후의 반죽', '작은 오븐', '밀빛 베이커리', '바람 소금빵']],
    ['u-named-honbab', 'honbab_lab', '혼밥연구소', '혼자 먹기 편한 자리를 찾아', true, '혼밥 가이드', 2640,
      'korean', '🍱', '#F4DDB8', ['한자리 식당', '소담 한 상', '고요한 덮밥', '둥근 식탁', '작은 반상']],
  ];
  named.forEach(([userId, handle, displayName, bio, verified, badge, followers, category, emoji, bg, places], person) => {
    db.publicProfiles.push({ userId, handle, displayName, bio, verified, badge,
      baseFollowers: followers, createdAt: ago(30000 - person * 3000) });
    places.forEach((place, index) => db.posts.push({
      id: uuid(), userId, place, area: '가상 동네', taste: 4 + index % 2, worth: 4, recommend: 5,
      note: ['한 그릇 잘 먹었다', '다시 가고 싶은 맛', '조용히 먹기 좋았어', '끝까지 맛있게 먹음', '오늘의 한입'][index],
      menu: '', price: 10000 + index * 1500, withUserIds: [], category, isPublic: true,
      photoData: demoPhoto(userId, place), eatenOn: addDays(today, -index),
      createdAt: ago((index + 1) * 720 + person * 20),
    }));
  });
  db.follows.push({ follower: ME, followee: 'u-named-naeng', createdAt: ago(120) });
  db.threads = db.threads.map((t) => ({ ...t,
    lastMessageAt: db.messages.filter((m) => m.threadId === t.id).map((m) => m.createdAt).sort().at(-1) ?? null }));
  db.version = 7;
  return db;
}

// v2.0 합성 수치는 이 체험 저장소에만 둔다. 실제 사용자 인증으로 취급하지 않는다.
function upgradeV20(db) {
  if (db.version >= 10) return db;
  db.userPrefs ??= [];
  db.statsPopulation ??= DEMO_STATS_POPULATION;
  db.postVerifications ??= [];
  db.verificationUsage ??= [];
  db.lists ??= [];
  db.demoBowlOffsets = [
    { userId: 'u-named-naeng', category: 'pyeongyang_naengmyeon', verified: 312, total: 313 },
    { userId: 'u-named-gukbap', category: 'gukbap', verified: 146, total: 147 },
  ];
  const now = Date.now();
  db.posts.filter((p) => p.userId === ME && p.category === 'pyeongyang_naengmyeon').slice(0, 3)
    .forEach((p, i) => {
      if (db.postVerifications.some((v) => v.postId === p.id)) return;
      const createdAt = new Date(now - (i + 2) * 86400000).toISOString();
      const v = { postId: p.id, userId: ME, category: p.category, receiptHash: 'demo-receipt-' + p.id,
        receiptStore: p.place, receiptDate: p.eatenOn, photoHash: null, aiCategory: null, aiConfidence: null,
        methods: ['receipt'], createdAt };
      db.postVerifications.push(v);
      db.verificationUsage.push({ postId: p.id, userId: ME, category: p.category,
        receiptHash: v.receiptHash, photoHash: null, createdAt });
    });
  const places = [...new Set(db.posts.filter((p) => p.category === 'pyeongyang_naengmyeon').map((p) => p.place))];
  db.demoExpertRatings = places.map((place, i) => ({
    place, category: 'pyeongyang_naengmyeon', eligibleBowls: 312, raters: 5 + i % 10,
    taste: (42 + i % 7) / 10, worth: (42 + (i + 2) % 7) / 10, recommend: (42 + (i + 4) % 7) / 10,
  }));
  const addList = (ownerId, groupId, isPublic, title, description, items, days) => {
    const createdAt = new Date(now - days * 86400000).toISOString();
    db.lists.push({ id: uuid(), ownerId, groupId, isPublic, title, description, items, createdAt, updatedAt: createdAt });
  };
  if (db.publicProfiles.some((p) => p.userId === 'u-named-naeng')) {
    addList('u-named-naeng', null, true, '평냉 입문 5선', '처음 드시는 분께 권하는 가상 가게예요.',
      ['구름 면옥', '새벽 냉면방', '달빛 면가', '여울 면옥', '은빛 냉면'].map((place, i) => ({
        place, area: '가상 동네', note: ['육수가 부드러워요.', '면 향이 은은해요.', '처음엔 양념 없이 드세요.', '편하게 한 그릇 드세요.', '마지막 국물까지 즐겨요.'][i],
      })), 1);
  }
  if (db.groups.some((g) => g.id === 'g-demo-1') && db.members.some((m) => m.groupId === 'g-demo-1' && m.userId === 'u-minji')) {
    addList('u-minji', 'g-demo-1', false, '을지로 노포 모음', '친구들과 함께 가고 싶은 곳이에요.',
      ['골목 국밥집', '을지 면가', '골목끝 탕집'].map((place, i) => ({
        place, area: '을지로', note: ['따뜻한 국물로 시작해요.', '점심에 들르기 좋아요.', '여럿이 함께 가요.'][i],
      })), 2);
  }
  addList(ME, null, false, '다음에 가 볼 곳', '다시 생각나는 가게를 모았어요.',
    [{ place: '동네 면옥', area: '동네', note: '주말 점심에 가요.' }], 3);
  db.version = 10;
  return db;
}


function upgradeSafetyData(db) {
  if (db.chatBlocks && db.uploadUsage) return db;
  const usage = new Map();
  for (const p of db.posts) {
    const day = new Date(Date.parse(p.createdAt) + 9 * 3600000).toISOString().slice(0, 10);
    const key = `${p.userId}/${day}`;
    const row = usage.get(key) || { userId: p.userId, day, posts: 0, photos: 0 };
    row.posts++;
    if (p.photoData || p.photoPath) row.photos++;
    usage.set(key, row);
  }
  return { ...db, chatBlocks: db.chatBlocks || [], uploadUsage: db.uploadUsage || [...usage.values()] };
}

export async function createDemoStore() {
  let db = load();
  if (!db) {
    db = seed();
    save(db);
  } else if (![7, 8, 9, 10].includes(db.version)) {
    db = upgradeV17(db);
    save(db);
  }
  if (db.version < 8) {
    // 기존 동행 태그는 보존하고 공개만 해제한다. 재시작 시 반복 이관하지 않는다.
    db = { ...db, version: 8, posts: db.posts.map((p) =>
      p.isPublic && p.withUserIds?.length ? { ...p, isPublic: false } : p) };
    save(db);
  }
  if (db.version < 9) {
    db = { ...db, version: 9, userPrefs: db.userPrefs ?? [], statsPopulation: DEMO_STATS_POPULATION };
    save(db);
  }
  if (db.version < 10) {
    db = upgradeV20(db);
    save(db);
  }
  if (db.demoPhotos !== 2) {
    db = upgradeDemoPhotos(db);
    save(db);
  }

  if (!db.chatBlocks || !db.uploadUsage) {
    db = upgradeSafetyData(db);
    save(db);
  }
  if (!db.reports) { db = { ...db, reports: [] }; save(db); }
  let deleted = false;
  let deletionPrepared = false;

  const memberOf = (gid) => db.members.filter((m) => m.groupId === gid);
  const nickIn = (gid, uid) => memberOf(gid).find((m) => m.userId === uid)?.nickname || '?';
  const groupIdsOf = (pid) => db.postGroups.filter((x) => x.postId === pid).map((x) => x.groupId);
  const isMember = (gid) => memberOf(gid).some((m) => m.userId === ME);
  const assertShared = (gid, pid) => {
    if (!isMember(gid) || !db.posts.some((p) => p.id === pid) || !groupIdsOf(pid).includes(gid)) {
      throw new Error('이 모임에 공유된 글에만 반응과 댓글을 남길 수 있어요.');
    }
  };
  const commit = (next) => {
    if (deleted) throw inviteError('not_signed_in');
    save(next);
    db = next;
  };
  const pendingInvite = (id, role) => {
    const invite = db.invites.find((v) => v.id === id && v[role] === ME);
    if (!invite) throw inviteError('invite_unavailable');
    if (invite.status !== 'pending') throw inviteError('invite_closed');
    return invite;
  };
  const replaceInvite = (invite) => {
    commit({ ...db, invites: db.invites.map((v) => v.id === invite.id ? invite : v) });
    return inviteView(invite);
  };
  const threadListeners = new Map();
  const replyTimers = new Map();
  const accessibleThread = (id) => db.threads.find((t) => t.id === id && isMember(t.groupId)
    && (t.kind === 'group' || ([t.userA, t.userB].includes(ME)
      && [t.userA, t.userB].every((uid) => memberOf(t.groupId).some((m) => m.userId === uid)))));
  const chatBlocked = (userId) => db.chatBlocks.some((b) => b.blocker === ME && b.blocked === userId && !b.endedAt);
  const blockedDuring = (userId, at) => db.chatBlocks.some((b) => b.blocker === ME && b.blocked === userId
    && at >= b.createdAt && (!b.endedAt || at <= b.endedAt));
  const visibleThread = (id) => {
    const t = accessibleThread(id);
    return t && (t.kind === 'group' || !chatBlocked(t.userA === ME ? t.userB : t.userA)) ? t : undefined;
  };
  const messageView = (m) => ({
    id: m.id, threadId: m.threadId, senderId: m.senderId, kind: m.kind, body: m.body,
    inviteId: m.inviteId ?? null, pollId: m.pollId ?? null, createdAt: m.createdAt,
  });
  const isVisibleMessage = (m, thread = visibleThread(m.threadId)) => Boolean(thread)
    && (thread.kind === 'group' || (!db.inviteBlocks.some((b) => b.blocker === ME && b.blocked === m.senderId)
      && !blockedDuring(m.senderId, m.createdAt)));
  const visibleMessages = (threadId) => db.messages.filter((m) => m.threadId === threadId && isVisibleMessage(m))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const threadView = (t) => {
    const messages = visibleMessages(t.id);
    const last = messages.at(-1);
    const read = db.threadReads.find((r) => r.threadId === t.id && r.userId === ME);
    return { id: t.id, groupId: t.groupId, kind: t.kind,
      otherUserId: t.kind === 'dm' ? (t.userA === ME ? t.userB : t.userA) : null,
      lastMessage: last ? { kind: last.kind, body: last.body, senderId: last.senderId, createdAt: last.createdAt } : null,
      unread: messages.filter((m) => m.senderId !== ME && (!read || m.createdAt > read.lastReadAt)).length,
      lastMessageAt: last?.createdAt ?? t.createdAt };
  };
  const listThreads = async () => db.threads.filter((t) => visibleThread(t.id)).map(threadView)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || a.id.localeCompare(b.id));
  const emitMessage = (message) => {
    if (!isVisibleMessage(message)) return;
    for (const listener of threadListeners.get(message.threadId) || []) {
      try { listener(messageView(message)); } catch (error) { console.warn('채팅 수신 처리 실패', error); }
    }
  };
  const scheduleReply = (threadId) => {
    const thread = visibleThread(threadId);
    if (!thread || thread.kind !== 'dm' || thread.autoReplied || !thread.autoReplyAt || replyTimers.has(threadId)) return;
    const timer = setTimeout(() => {
      replyTimers.delete(threadId);
      const current = visibleThread(threadId);
      if (!current || current.autoReplied) return;
      const other = current.userA === ME ? current.userB : current.userA;
      const message = messageRecord(threadId, other, 'text', other === 'u-minji' ? '좋아 ㅋㅋ 이따 얘기하자' : 'ㅇㅋ 좋아 ㅋㅋ');
      try {
        commit(withMessages({ ...db, threads: db.threads.map((t) => t.id === threadId
          ? { ...t, autoReplied: true, autoReplyAt: null } : t) }, [message]));
        emitMessage(message);
      } catch (error) { console.warn('체험 채팅 답장 저장 실패', error); }
    }, Math.max(0, Date.parse(thread.autoReplyAt) - Date.now()));
    replyTimers.set(threadId, timer);
  };
  const pollView = (p) => ({
    id: p.id, groupId: p.groupId, creatorId: p.creatorId, title: p.title,
    options: p.options.map(({ place, area }) => ({ place, area: area || '' })),
    votes: db.pollsVotes.filter((v) => v.pollId === p.id).sort((a, b) => a.userId.localeCompare(b.userId))
      .map(({ userId, optionIdx }) => ({ userId, optionIdx })),
    closesAt: p.closesAt ?? null,
    closed: p.closed === true || (p.closesAt != null && Date.parse(p.closesAt) <= Date.now()),
    createdAt: p.createdAt,
  });
  const getPoll = (id) => {
    const poll = db.polls.find((p) => p.id === id && isMember(p.groupId));
    if (!poll) throw inviteError('bad_poll');
    return poll;
  };
  const commentView = (c) => ({ id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt });
  const view = (p, nickname, groupId = null) => ({
    id: p.id, userId: p.userId, nickname, place: p.place, area: p.area || '', taste: p.taste, worth: p.worth,
    recommend: p.recommend, note: p.note || '', photoUrl: p.photoThumbData || p.photoData || null,
    originalPhotoUrl: p.photoData || null, eatenOn: p.eatenOn,
    createdAt: p.createdAt, groupIds: groupIdsOf(p.id),
    menu: p.menu || '', price: p.price ?? null, withUserIds: [...(p.withUserIds || [])],
    category: p.category ?? null, isPublic: p.isPublic === true,
    verified: db.postVerifications.some((v) => v.postId === p.id),
    verifiedBy: [...(db.postVerifications.find((v) => v.postId === p.id)?.methods || [])],
    reactions: groupId === null ? [] : db.reactions
      .filter((r) => r.groupId === groupId && r.postId === p.id)
      .map((r) => ({ userId: r.userId, kind: r.kind })),
    comments: groupId === null ? [] : db.comments
      .filter((c) => c.groupId === groupId && c.postId === p.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(commentView),
  });

  const namedView = (p) => {
    const posts = db.posts.filter((post) => post.userId === p.userId && post.isPublic);
    const counts = new Map();
    for (const post of posts) if (post.category) counts.set(post.category, (counts.get(post.category) || 0) + 1);
    return { userId: p.userId, handle: p.handle, displayName: p.displayName, bio: p.bio || '',
      verified: p.verified === true, badge: p.badge ?? null,
      followers: (p.baseFollowers || 0) + db.follows.filter((f) => f.followee === p.userId).length,
      postCount: posts.length,
      topCategory: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
      isFollowing: db.follows.some((f) => f.follower === ME && f.followee === p.userId) };
  };
  const publicPosts = (users) => db.posts.filter((p) => p.isPublic && users.has(p.userId)
      && db.publicProfiles.some((profile) => profile.userId === p.userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 100)
    .map((p) => ({ ...view(p, db.publicProfiles.find((profile) => profile.userId === p.userId).displayName), groupIds: [], withUserIds: [] }));
  const kstDay = (date) => new Date(Date.parse(date) + 9 * 3600000).toISOString().slice(0, 10);
  // 체험용 예시 통계는 가상 네임드가 들어 있는 기본 체험 데이터에서만 쓴다(테스트 데이터·실제 모드엔 없음).
  const showcase = () => db.publicProfiles.some((p) => p.userId === 'u-named-naeng');
  const bowls = (userId) => {
    if (userId !== ME && !db.publicProfiles.some((p) => p.userId === userId)) return [];
    const result = new Map();
    const verified = new Set(db.postVerifications.map((v) => v.postId));
    for (const p of db.posts) {
      if (p.userId !== userId || !p.category) continue;
      if (userId !== ME && !p.isPublic) continue;
      const row = result.get(p.category) || { category: p.category, verified: 0, total: 0 };
      row.total++;
      if (verified.has(p.id)) row.verified++;
      result.set(p.category, row);
    }
    for (const offset of db.demoBowlOffsets || []) {
      // 체험 모드 전용: 가상 네임드의 '공개 인증 그릇'을 글 수백 개 대신 보정값으로 보여 준다(화면에 체험용 표시).
      // 위에서 이미 나 또는 공개 프로필만 통과했다. 실제 모드(store-supabase)는 공개 글만 센다.
      if (offset.userId !== userId || (userId !== ME && !showcase())) continue;
      const row = result.get(offset.category) || { category: offset.category, verified: 0, total: 0 };
      row.verified += offset.verified;
      row.total += offset.total;
      result.set(offset.category, row);
    }
    return [...result.values()].sort((a, b) => a.category.localeCompare(b.category));
  };
  const canReadList = (l) => l.ownerId === ME || (l.groupId !== null ? isMember(l.groupId)
    : l.isPublic && db.publicProfiles.some((p) => p.userId === l.ownerId));
  const listView = (l) => ({
    id: l.id, ownerId: l.ownerId,
    ownerName: db.publicProfiles.find((p) => p.userId === l.ownerId)?.displayName
      || db.members.find((m) => m.userId === l.ownerId && (l.groupId === null || m.groupId === l.groupId))?.nickname || '나',
    groupId: l.groupId, isPublic: l.isPublic, title: l.title, description: l.description,
    items: l.items.map(({ place, area, note }) => ({ place, area, note })), createdAt: l.createdAt, updatedAt: l.updatedAt,
  });


  for (const thread of db.threads) scheduleReply(thread.id);

  return {
    mode: 'demo',
    async photoUrls(posts) { return posts; },
    me: () => deleted ? null : ME,

    async getMyAccountDeletion() { return deletionPrepared; },

    async cancelMyAccountDeletion() {
      if (deleted) throw inviteError('not_signed_in');
      deletionPrepared = false;
    },

    async deleteMyAccount() {
      deletionPrepared = true;
      // 체험 데이터는 이 기기에만 있으므로 예시까지 모두 지운다.
      for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
        if (!storage) continue;
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (key?.startsWith('hanip-')) storage.removeItem(key);
        }
      }
      for (const timer of replyTimers.values()) clearTimeout(timer);
      replyTimers.clear();
      threadListeners.clear();
      db = Object.fromEntries(Object.entries(db).map(([key, value]) => [key, Array.isArray(value) ? [] : value]));
      deleted = true;
      deletionPrepared = false;
    },

    async listReportedTargets() {
      return db.reports.filter((r) => r.reporter === ME)
        .map(({ targetType, targetId }) => ({ targetType, targetId }));
    },

    async reportContent(input) {
      if (deleted) throw inviteError('not_signed_in');
      if (deletionPrepared) throw inviteError('account_deleting');
      const r = reportInput(input);
      if (!isMember(r.groupId)) throw inviteError('not_member');
      let owner;
      if (r.targetType === 'post' && groupIdsOf(r.targetId).includes(r.groupId)) {
        owner = db.posts.find((p) => p.id === r.targetId)?.userId;
      } else if (r.targetType === 'comment') {
        const c = db.comments.find((c) => c.id === r.targetId && c.groupId === r.groupId);
        if (c && groupIdsOf(c.postId).includes(r.groupId)) owner = c.userId;
      } else if (r.targetType === 'message') {
        const m = db.messages.find((m) => m.id === r.targetId);
        const thread = m && accessibleThread(m.threadId);
        if (thread?.groupId === r.groupId) owner = m.senderId;
      } else if (r.targetType === 'member') {
        owner = memberOf(r.groupId).find((m) => m.userId === r.targetId)?.userId;
      }
      if (!owner || owner !== r.targetUser) throw inviteError('report_unavailable');
      if (owner === ME) throw inviteError('report_self');
      if (db.reports.some((v) => v.reporter === ME && v.targetType === r.targetType && v.targetId === r.targetId)) {
        throw inviteError('report_duplicate');
      }
      const createdAt = new Date().toISOString();
      if (db.reports.filter((v) => v.reporter === ME && kstDay(v.createdAt) === kstDay(createdAt)).length >= 20) {
        throw inviteError('report_daily_limit');
      }
      const id = uuid();
      commit({ ...db, reports: [...db.reports, { id, reporter: ME, ...r, createdAt }] });
      return id;
    },

    async blockChatUser(userId) {
      if (userId === ME || !db.members.some((m) => m.userId === userId && isMember(m.groupId))) throw inviteError('bad_chat_block');
      if (chatBlocked(userId)) return;
      commit({ ...db, chatBlocks: [...db.chatBlocks, { blocker: ME, blocked: userId,
        createdAt: new Date().toISOString(), endedAt: null }] });
    },

    async unblockChatUser(userId) {
      commit({ ...db, chatBlocks: db.chatBlocks.map((b) => b.blocker === ME && b.blocked === userId && !b.endedAt
        ? { ...b, endedAt: new Date().toISOString() } : b) });
    },

    async listChatBlocked() {
      return db.chatBlocks.filter((b) => b.blocker === ME && !b.endedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((b) => ({ userId: b.blocked, createdAt: b.createdAt }));
    },

    async verifyPost(postId, input = {}) {
      const p = db.posts.find((p) => p.id === postId && p.userId === ME);
      const rejected = (reason) => ({ verified: false, reason });
      if (!p) return rejected('not_owner');
      const v = verificationInput(input);
      if (v.receiptHash && db.verificationUsage.some((u) => u.receiptHash === v.receiptHash)) return rejected('duplicate_receipt');
      if (v.photoHash && db.verificationUsage.some((u) => u.photoHash === v.photoHash)) return rejected('duplicate_photo');
      if (!CATEGORIES.includes(p.category)) return rejected('mismatch');
      const prior = db.postVerifications.find((r) => r.postId === postId);
      if ((v.receiptHash && prior?.receiptHash) || (v.photoHash && prior?.photoHash)
          || (!prior && db.verificationUsage.some((u) => u.postId === postId))) return rejected('mismatch');
      const store = normPlace(v.receiptStore), place = normPlace(p.place);
      const short = Math.min([...store].length, [...place].length);
      const long = Math.max([...store].length, [...place].length);
      const similar = store !== '' && (store === place
        || (short >= 2 && short >= long * 0.6 && (store.includes(place) || place.includes(store))));
      const receipt = validText(v.receiptHash, 1, 256) && similar && v.receiptDate !== null
        && Math.abs(Date.parse(v.receiptDate) - Date.parse(p.eatenOn)) <= 86400000;
      const photo = validText(v.photoHash, 1, 256) && v.aiCategory === p.category
        && v.aiConfidence !== null && v.aiConfidence >= 0.8;
      if (!receipt && !photo) return rejected('mismatch');
      const now = new Date().toISOString();
      if (!prior && db.verificationUsage.filter((u) => u.userId === ME && u.category === p.category
          && kstDay(u.createdAt) === kstDay(now)).length >= 2) return rejected('daily_limit');
      const record = {
        postId, userId: ME, category: p.category,
        receiptHash: receipt ? v.receiptHash : prior?.receiptHash ?? null,
        receiptStore: receipt ? v.receiptStore.trim() : prior?.receiptStore ?? null,
        receiptDate: receipt ? v.receiptDate : prior?.receiptDate ?? null,
        photoHash: photo ? v.photoHash : prior?.photoHash ?? null,
        aiCategory: photo ? v.aiCategory : prior?.aiCategory ?? null,
        aiConfidence: photo ? Math.fround(v.aiConfidence) : prior?.aiConfidence ?? null,
        methods: ['receipt', 'photo'].filter((m) => m === 'receipt' ? receipt || prior?.methods.includes(m) : photo || prior?.methods.includes(m)),
        createdAt: prior?.createdAt ?? now,
      };
      commit({ ...db,
        postVerifications: [...db.postVerifications.filter((v) => v.postId !== postId), record],
        verificationUsage: [...db.verificationUsage.filter((v) => v.postId !== postId),
          { postId, userId: ME, category: p.category, receiptHash: record.receiptHash, photoHash: record.photoHash, createdAt: record.createdAt }],
      });
      return { verified: true, reason: null };
    },

    async myBowls() { return bowls(ME); },
    async userBowls(userId) { return bowls(userId); },

    async expertRating(place, category, minBowls = 50) {
      if (!CATEGORIES.includes(category)) throw inviteError('bad_category');
      if (!validText(typeof place === 'string' ? place.trim() : place, 1, 40)
          || minBowls !== 50) return null;
      const excluded = new Set(db.userPrefs.filter((p) => p.statsOptOut).map((p) => p.userId));
      const profiles = new Set(db.publicProfiles.map((p) => p.userId));
      const visible = db.posts.filter((p) => p.isPublic && p.category === category
        && profiles.has(p.userId) && !excluded.has(p.userId));
      const verified = new Set(db.postVerifications.map((v) => v.postId));
      const counts = new Map();
      for (const p of visible) {
        if (verified.has(p.id)) counts.set(p.userId, (counts.get(p.userId) || 0) + 1);
      }
      const records = visible.filter((p) => normPlace(p.place) === normPlace(place)
        && (counts.get(p.userId) || 0) >= 50);
      const raters = new Set(records.map((p) => p.userId)).size;
      if (raters >= 5) {
        const avg = (key) => Math.round(records.reduce((sum, p) => sum + p[key], 0) / records.length * 10) / 10;
        return { raters, taste: avg('taste'), worth: avg('worth'), recommend: avg('recommend'), minBowls };
      }
      // 체험 모드 전용 예시 통계(화면에 '체험용 예시'로 표시). 실제 모드는 위 규칙만 쓴다.
      const demo = showcase() && (db.demoExpertRatings || []).find((r) => r.category === category && normPlace(r.place) === normPlace(place));
      return demo ? { raters: demo.raters, taste: demo.taste, worth: demo.worth, recommend: demo.recommend, minBowls, demo: true } : null;
    },

    async listLists({ scope = 'mine', groupId = null } = {}) {
      if (!['mine', 'group', 'public'].includes(scope)) throw inviteError('bad_list');
      return db.lists.filter((l) => canReadList(l) && (scope === 'mine' ? l.ownerId === ME
        : scope === 'group' ? l.groupId === groupId && isMember(groupId)
          : l.groupId === null && l.isPublic && db.publicProfiles.some((p) => p.userId === l.ownerId)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)).slice(0, 50).map(listView);
    },

    async getList(id) {
      const list = db.lists.find((l) => l.id === id && canReadList(l));
      return list ? listView(list) : null;
    },

    async saveList(input) {
      const v = listInput(input);
      const prior = v.id === null ? null : db.lists.find((l) => l.id === v.id && l.ownerId === ME);
      if (v.id !== null && !prior) throw inviteError('not_owner');
      if (v.groupId !== null && !isMember(v.groupId)) throw inviteError('not_member');
      if (v.isPublic && !db.publicProfiles.some((p) => p.userId === ME)) throw inviteError('no_public_profile');
      const now = new Date().toISOString();
      const list = { ...v, id: prior?.id ?? uuid(), ownerId: ME, createdAt: prior?.createdAt ?? now, updatedAt: now };
      commit({ ...db, lists: [...db.lists.filter((l) => l.id !== list.id), list] });
      return listView(list);
    },

    async deleteList(id) {
      if (!db.lists.some((l) => l.id === id && l.ownerId === ME)) throw inviteError('not_owner');
      commit({ ...db, lists: db.lists.filter((l) => l.id !== id) });
    },


    async listMyGroups() {
      return db.groups
        .filter((g) => memberOf(g.id).some((m) => m.userId === ME))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((g) => ({
          id: g.id, name: g.name, code: g.code, myNickname: nickIn(g.id, ME),
          members: memberOf(g.id).map((m) => ({ userId: m.userId, nickname: m.nickname, bio: m.bio || '' })),
        }));
    },

    async setBio(groupId, bio) {
      if (bio !== null && !validText(typeof bio === 'string' ? bio.trim() : bio, 0, 60)) {
        throw inviteError('bad_bio');
      }
      if (!isMember(groupId)) throw inviteError('not_member');
      commit({ ...db, members: db.members.map((m) => m.groupId === groupId && m.userId === ME
        ? { ...m, bio: bio?.trim() || null } : m) });
    },

    listThreads,

    async openDm(groupId, otherUserId) {
      if (otherUserId === ME || chatBlocked(otherUserId) || !isMember(groupId)
          || !memberOf(groupId).some((m) => m.userId === otherUserId)) throw inviteError('thread_closed');
      const next = { ...db, threads: [...db.threads] };
      const thread = ensureThread(next, groupId, 'dm', ME, otherUserId);
      commit(next);
      return threadView(thread);
    },

    async listMessages(threadId) {
      return visibleMessages(threadId).slice(-200).map(messageView);
    },

    async sendMessage(threadId, body) {
      if (!validText(typeof body === 'string' ? body.trim() : body, 1, 300)) throw inviteError('bad_message');
      const thread = accessibleThread(threadId);
      if (!thread) throw inviteError('thread_closed');
      const message = messageRecord(threadId, ME, 'text', body.trim());
      let next = withMessages(db, [message]);
      if (thread.kind === 'dm' && !thread.autoReplied && !thread.autoReplyAt) {
        next = { ...next, threads: next.threads.map((t) => t.id === threadId
          ? { ...t, autoReplyAt: new Date(Date.now() + 3000).toISOString() } : t) };
      }
      commit(next);
      emitMessage(message);
      scheduleReply(threadId);
      return messageView(message);
    },

    async markThreadRead(threadId, until) {
      if (until == null) return;
      if (typeof until !== 'string' || !Number.isFinite(Date.parse(until))) throw inviteError('bad_read_until');
      if (!visibleThread(threadId)) throw inviteError('thread_closed');
      const previous = db.threadReads.find((r) => r.threadId === threadId && r.userId === ME);
      const boundary = Math.min(Date.parse(until), Date.now());
      const lastReadAt = new Date(Math.max(boundary, previous ? Date.parse(previous.lastReadAt) : -Infinity)).toISOString();
      commit({ ...db, threadReads: [
        ...db.threadReads.filter((r) => !(r.threadId === threadId && r.userId === ME)),
        { threadId, userId: ME, lastReadAt },
      ] });
    },

    async unreadTotal() {
      return (await listThreads()).reduce((sum, thread) => sum + thread.unread, 0);
    },

    subscribeThread(threadId, onMessage) {
      if (!visibleThread(threadId)) return () => {};
      let listeners = threadListeners.get(threadId);
      if (!listeners) threadListeners.set(threadId, listeners = new Set());
      const listener = (message) => onMessage(message);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && threadListeners.get(threadId) === listeners) threadListeners.delete(threadId);
      };
    },

    async getStatsOptOut() {
      return db.userPrefs?.find((p) => p.userId === ME)?.statsOptOut === true;
    },

    async setStatsOptOut(optOut) {
      if (typeof optOut !== 'boolean') throw inviteError('bad_stats_opt_out');
      commit({ ...db, userPrefs: [...(db.userPrefs || []).filter((p) => p.userId !== ME),
        { userId: ME, statsOptOut: optOut, updatedAt: new Date().toISOString() }] });
    },

    async categoryRank(category, ym) {
      if (!CATEGORIES.includes(category)) throw inviteError('bad_category');
      if (typeof ym !== 'string' || ym.length !== 7 || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(ym) || ym.startsWith('0000')) {
        throw inviteError('bad_month');
      }
      const excluded = new Set((db.userPrefs || []).filter((p) => p.statsOptOut).map((p) => p.userId));
      const counts = new Map();
      let myCount = 0;
      for (const post of db.posts) {
        if (post.category === category && post.eatenOn.startsWith(ym + '-')) {
          if (post.userId === ME) myCount++;
          if (!excluded.has(post.userId)) counts.set(post.userId, (counts.get(post.userId) || 0) + 1);
        }
      }
      if (excluded.has(ME)) return { users: null, myCount, topPercent: null, optedOut: true };
      const sample = db.statsPopulation ?? DEMO_STATS_POPULATION;
      const users = counts.size + sample.reduce((sum, bucket) => sum + bucket.users, 0);
      const rank = 1 + [...counts.values()].filter((count) => count > myCount).length
        + sample.filter((bucket) => bucket.count > myCount).reduce((sum, bucket) => sum + bucket.users, 0);
      return { users: users < 50 ? null : Math.floor(users / 10) * 10, myCount,
        topPercent: users < 50 ? null : Math.min(100, Math.max(5, Math.ceil(rank * 20 / users) * 5)), optedOut: false };
    },

    async listNamed({ sort = 'followers' } = {}) {
      return [...db.publicProfiles].sort((a, b) =>
        (sort === 'new' ? 0 : namedView(b).followers - namedView(a).followers)
        || b.createdAt.localeCompare(a.createdAt) || a.userId.localeCompare(b.userId)).map(namedView);
    },

    async getNamed(handle) {
      const profile = db.publicProfiles.find((p) => p.handle === handle);
      return profile ? { profile: namedView(profile), posts: publicPosts(new Set([profile.userId])) }
        : { profile: null, posts: [] };
    },

    async follow(userId) {
      if (userId === ME || !db.publicProfiles.some((p) => p.userId === userId)) throw inviteError('bad_follow');
      if (db.follows.some((f) => f.follower === ME && f.followee === userId)) return;
      commit({ ...db, follows: [...db.follows, { follower: ME, followee: userId, createdAt: new Date().toISOString() }] });
    },

    async unfollow(userId) {
      commit({ ...db, follows: db.follows.filter((f) => !(f.follower === ME && f.followee === userId)) });
    },

    async myPublicProfile() {
      const profile = db.publicProfiles.find((p) => p.userId === ME);
      return profile ? namedView(profile) : null;
    },

    async savePublicProfile({ handle, displayName, bio = '' }) {
      if (typeof handle !== 'string' || handle !== handle.trim() || !/^[a-z0-9_]{3,20}$/.test(handle)) throw inviteError('bad_handle');
      bio = bio ?? '';
      if (!validText(typeof displayName === 'string' ? displayName.trim() : displayName, 1, 20)
          || !validText(bio, 0, 80)) throw inviteError('bad_public_profile');
      const existing = db.publicProfiles.find((p) => p.userId === ME);
      if (existing && existing.handle !== handle) throw inviteError('handle_immutable');
      if (db.publicProfiles.some((p) => p.handle === handle && p.userId !== ME)) throw inviteError('handle_taken');
      const profile = { userId: ME, verified: false, badge: null, baseFollowers: 0,
        createdAt: new Date().toISOString(), ...existing, handle, displayName: displayName.trim(), bio: bio.trim() };
      commit({ ...db, publicProfiles: [...db.publicProfiles.filter((p) => p.userId !== ME), profile] });
      return namedView(profile);
    },

    async followingFeed() {
      return publicPosts(new Set(db.follows.filter((f) => f.follower === ME).map((f) => f.followee)));
    },

    async listPolls(groupId, ids = null) {
      if (!isMember(groupId)) return [];
      const selected = ids === null ? null : new Set(ids);
      const rows = db.polls.filter((p) => p.groupId === groupId && (selected === null || selected.has(p.id)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return (selected === null ? rows.slice(0, 30) : rows).map(pollView);
    },

    async createPoll(groupId, input) {
      const values = pollInput(input);
      if (!isMember(groupId)) throw inviteError('bad_poll');
      const poll = { id: uuid(), groupId, creatorId: ME, ...values, closed: false, createdAt: new Date().toISOString() };
      const next = { ...db, polls: [...db.polls, poll], threads: [...db.threads] };
      const thread = ensureThread(next, groupId, 'group');
      const message = messageRecord(thread.id, ME, 'poll', '', { pollId: poll.id });
      commit(withMessages(next, [message]));
      emitMessage(message);
      return pollView(poll);
    },

    async votePoll(pollId, optionIdx) {
      if (optionIdx !== null && (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 5)) {
        throw inviteError('bad_poll');
      }
      const poll = getPoll(pollId);
      if (pollView(poll).closed) throw inviteError('poll_closed');
      if (optionIdx !== null && optionIdx >= poll.options.length) throw inviteError('bad_poll');
      const votes = db.pollsVotes.filter((v) => !(v.pollId === pollId && v.userId === ME));
      if (optionIdx !== null) votes.push({ pollId, userId: ME, optionIdx, createdAt: new Date().toISOString() });
      commit({ ...db, pollsVotes: votes });
      return pollView(poll);
    },

    async closePoll(pollId) {
      const poll = getPoll(pollId);
      if (poll.creatorId !== ME) throw inviteError('bad_poll');
      const closed = { ...poll, closed: true };
      commit({ ...db, polls: db.polls.map((p) => p.id === pollId ? closed : p) });
      return pollView(closed);
    },

    async createGroup(name, nickname) {
      const id = uuid();
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const next = { ...db, groups: [...db.groups, { id, name: name.trim(), code, createdAt: new Date().toISOString() }],
        members: [...db.members, { groupId: id, userId: ME, nickname: nickname.trim(), bio: '' }],
        threads: [...db.threads] };
      ensureThread(next, id, 'group');
      commit(next);
      return { id, name, code, status: 'created' };
    },

    async joinGroup(code) {
      const g = db.groups.find((x) => x.code === code.trim().toUpperCase());
      if (!g) throw new Error('group_not_found');
      if (!memberOf(g.id).some((m) => m.userId === ME)) throw new Error('demo_join_unavailable');
      const next = { ...db, threads: [...db.threads] };
      ensureThread(next, g.id, 'group');
      commit(next);
      return { id: g.id, name: g.name, code: g.code, status: 'already' };
    },

    async groupFeed(groupId, since) {
      if (!isMember(groupId)) return [];
      const ids = new Set(db.postGroups.filter((x) => x.groupId === groupId).map((x) => x.postId));
      return db.posts
        .filter((p) => ids.has(p.id) && p.eatenOn >= since)
        .sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt))
        .map((p) => view(p, nickIn(groupId, p.userId), groupId));
    },

    async myPosts() {
      return db.posts
        .filter((p) => p.userId === ME)
        .sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt))
        .map((p) => view(p, '나'));
    },

    // 실제 저장소와 동일하게 from 포함, to 제외.
    async myPostsInRange(from, to) {
      const validDate = (date) => typeof date === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$/.test(date)
        && !date.startsWith('0000') && Number.isFinite(Date.parse(date))
        && new Date(date).toISOString().slice(0, 10) === date;
      if (!validDate(from) || !validDate(to) || from > to) throw inviteError('bad_date_range');
      return db.posts.filter((p) => p.userId === ME && p.eatenOn >= from && p.eatenOn < to)
        .sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map((p) => view(p, '나'));
    },

    async myPostsInMonth(ym) {
      if (typeof ym !== 'string' || ym.length !== 7 || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(ym) || ym.startsWith('0000')) {
        throw inviteError('bad_month');
      }
      return db.posts.filter((p) => p.userId === ME && p.eatenOn.startsWith(ym + '-'))
        .sort((a, b) => b.eatenOn.localeCompare(a.eatenOn) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map((p) => view(p, '나'));
    },

    async createPost(input) {
      if (deleted) throw inviteError('not_signed_in');
      if (deletionPrepared) throw inviteError('account_deleting');
      const category = input.category ?? null;
      const isPublic = input.isPublic ?? false;
      if (category !== null && !CATEGORIES.includes(category)) throw inviteError('bad_category');
      if (typeof isPublic !== 'boolean') throw inviteError('bad_public_profile');
      if (isPublic && !db.publicProfiles.some((p) => p.userId === ME)) throw inviteError('no_public_profile');
      const menu = input.menu ?? '';
      const price = input.price ?? null;
      const withUserIds = input.withUserIds ?? [];
      if (typeof menu !== 'string' || [...menu.trim()].length > 30) throw new Error('메뉴는 30자 이내로 적어 주세요.');
      if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1000000)) {
        throw new Error('1인 가격은 0~1,000,000원 사이의 정수로 적어 주세요.');
      }
      if (!Array.isArray(withUserIds) || withUserIds.length > 10
          || withUserIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new Error('같이 먹은 친구는 최대 10명까지 골라 주세요.');
      }
      const groupIds = [...new Set(input.groupIds || [])];
      const companions = isPublic ? [] : withUserIds;
      if (companions.some((uid) => !db.members.some((m) => m.userId === uid && isMember(m.groupId))
          || groupIds.some((gid) => !memberOf(gid).some((m) => m.userId === uid)))) {
        throw new Error('같이 먹은 친구는 최대 10명까지 골라 주세요.');
      }
      if (groupIds.some((gid) => !isMember(gid))) throw new Error('참여 중인 모임에만 글을 공유할 수 있어요.');
      const id = uuid();
      const photoData = input.photoBlob ? await blobToDataURL(input.photoBlob) : null;
      const photoThumbData = input.photoBlob && input.photoThumbBlob ? await blobToDataURL(input.photoThumbBlob) : null;
      // 사진 변환을 기다린 뒤 최신 원장을 검사해 동시 저장도 20개를 넘지 않는다.
      if (deleted) throw inviteError('not_signed_in');
      if (deletionPrepared) throw inviteError('account_deleting');
      const day = kstDay(new Date().toISOString());
      const usage = db.uploadUsage.find((r) => r.userId === ME && r.day === day) || { userId: ME, day, posts: 0, photos: 0 };
      if (usage.posts >= 20) throw inviteError('post_daily_limit');
      if (photoData && usage.photos >= 20) throw inviteError('photo_daily_limit');
      if (photoData && db.posts.filter((p) => p.userId === ME && (p.photoData || p.photoPath)).length >= 300) {
        throw inviteError('photo_total_limit');
      }
      const post = {
        id, userId: ME, place: input.place.trim(), area: (input.area || '').trim(), taste: input.taste,
        worth: input.worth, recommend: input.recommend, note: (input.note || '').trim(), photoData, photoThumbData,
        eatenOn: input.eatenOn, createdAt: new Date().toISOString(),
        menu: menu.trim() || null, price, withUserIds: [...companions], category, isPublic,
      };
      commit({
        ...db, posts: [...db.posts, post],
        uploadUsage: [...db.uploadUsage.filter((r) => !(r.userId === ME && r.day === day)),
          { ...usage, posts: usage.posts + 1, photos: usage.photos + (photoData ? 1 : 0) }],
        postGroups: [...db.postGroups, ...groupIds.map((groupId) => ({ postId: id, groupId }))],
      });
      return id;
    },

    async toggleReaction(groupId, postId, kind) {
      if (!REACTION_KINDS.includes(kind)) throw new Error('사용할 수 없는 반응이에요.');
      assertShared(groupId, postId);
      const matches = (r) => r.groupId === groupId && r.postId === postId && r.userId === ME && r.kind === kind;
      const on = !db.reactions.some(matches);
      const reactions = on
        ? [...db.reactions, { groupId, postId, userId: ME, kind, createdAt: new Date().toISOString() }]
        : db.reactions.filter((r) => !matches(r));
      commit({ ...db, reactions });
      return { on };
    },

    async addComment(groupId, postId, body) {
      if (typeof body !== 'string' || [...body.trim()].length < 1 || [...body.trim()].length > 100) {
        throw new Error('댓글은 1~100자로 적어 주세요.');
      }
      assertShared(groupId, postId);
      const comment = { id: uuid(), groupId, postId, userId: ME, body: body.trim(), createdAt: new Date().toISOString() };
      commit({ ...db, comments: [...db.comments, comment] });
      return commentView(comment);
    },

    async deleteComment(commentId) {
      if (!db.comments.some((c) => c.id === commentId && c.userId === ME)) {
        throw new Error('댓글을 지우지 못했어요. 본인 댓글인지 확인한 뒤 다시 해 주세요.');
      }
      commit({ ...db, comments: db.comments.filter((c) => c.id !== commentId) });
    },

    async myWants() {
      const posts = new Map(db.posts.map((p) => [p.id, p]));
      return db.reactions
        .filter((r) => r.userId === ME && r.kind === 'want' && isMember(r.groupId)
          && posts.has(r.postId) && groupIdsOf(r.postId).includes(r.groupId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)
          || a.groupId.localeCompare(b.groupId) || a.postId.localeCompare(b.postId))
        .map((r) => ({
          groupId: r.groupId, postId: r.postId, place: posts.get(r.postId).place,
        area: posts.get(r.postId).area || '', photoUrl: posts.get(r.postId).photoThumbData || posts.get(r.postId).photoData || null,
        originalPhotoUrl: posts.get(r.postId).photoData || null, createdAt: r.createdAt,
        }));
    },

    async removeWant(groupId, postId) {
      commit({ ...db, reactions: db.reactions.filter((r) => !(r.groupId === groupId
        && r.postId === postId && r.userId === ME && r.kind === 'want')) });
    },

    async listInvites(ids = null) {
      const blocked = new Set(db.inviteBlocks.filter((b) => b.blocker === ME).map((b) => b.blocked));
      const rows = db.invites.filter((v) => (v.fromUserId === ME || v.toUserId === ME) && !blocked.has(v.fromUserId)
        && !chatBlocked(v.fromUserId === ME ? v.toUserId : v.fromUserId) && !blockedDuring(v.fromUserId, v.createdAt))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (ids !== null) {
        const selected = new Set(ids);
        return rows.filter((v) => selected.has(v.id)).map(inviteView);
      }
      const recent = new Set(rows.slice(0, 200).map((v) => v.id));
      return rows.filter((v) =>
        recent.has(v.id) || ['pending', 'yes'].includes(v.status)
        || (v.fromUserId === ME && ['other', 'pass'].includes(v.status) && !v.seenByFrom)
      ).map(inviteView);
    },

    async sendInvite({ groupId, toUserId, place, area = '', postId = null, message = '', choices }) {
      if (toUserId === ME) throw inviteError('invite_self');
      if (!isMember(groupId) || !memberOf(groupId).some((m) => m.userId === toUserId)) {
        throw inviteError('invite_not_member');
      }
      area = area ?? '';
      message = message ?? '';
      if (!validText(place, 1, 40) || !validText(area, 0, 20) || !validText(message, 0, 60)
          || !Array.isArray(choices) || choices.length < 1 || choices.length > 3
          || choices.some((c) => !c || !validText(c.key, 1, 40) || !validText(c.label, 1, 30))
          || (postId !== null && (!db.posts.some((p) => p.id === postId) || !groupIdsOf(postId).includes(groupId)))) {
        throw inviteError('invite_bad');
      }
      const pair = db.invites.filter((v) => v.fromUserId === ME && v.toUserId === toUserId);
      if (pair.some((v) => v.status === 'pending')) throw inviteError('invite_duplicate');
      const now = new Date();
      if (pair.some((v) => v.status === 'pass' && v.respondedAt !== null
          && new Date(v.respondedAt).getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000)) {
        throw inviteError('invite_cooldown');
      }
      if (db.invites.filter((v) => v.fromUserId === ME && v.status === 'pending').length >= 10) {
        throw inviteError('invite_too_many');
      }
      const next = { ...db, threads: [...db.threads] };
      const thread = ensureThread(next, groupId, 'dm', ME, toUserId);
      const invite = {
        id: uuid(), threadId: thread.id, groupId, fromUserId: ME, toUserId, place, area, postId, message,
        choices: choices.map(({ key, label }) => ({ key, label })), status: 'pending', picked: null,
        replyNote: '', createdAt: now.toISOString(), respondedAt: null, seenByFrom: false,
      };
      const card = messageRecord(thread.id, ME, 'invite', '', { inviteId: invite.id });
      commit(withMessages({ ...next, invites: [...db.invites, invite] }, [card]));
      emitMessage(card);
      return inviteView(invite);
    },

    async respondInvite(inviteId, status, picked = null, replyNote = '') {
      const invite = pendingInvite(inviteId, 'toUserId');
      if (!visibleThread(invite.threadId)) throw inviteError('thread_closed');
      replyNote = replyNote ?? '';
      if (!['yes', 'other', 'pass'].includes(status) || !validText(replyNote, 0, 60)
          || (status === 'yes' && picked === null)
          || (picked !== null && !invite.choices.some((c) => c.label === picked))) {
        throw inviteError('invite_bad');
      }
      const next = { ...db, threads: [...db.threads] };
      const thread = ensureThread(next, invite.groupId, 'dm', invite.fromUserId, invite.toUserId);
      const updated = { ...invite, threadId: thread.id, status, picked, replyNote,
        respondedAt: new Date().toISOString(), seenByFrom: false };
      const body = status === 'yes' ? `좋아! ${picked}`
        : status === 'other' ? `다른 날 어때? ${replyNote}` : '이번엔 어려워';
      const message = messageRecord(thread.id, ME, 'invite_reply', body, { inviteId });
      commit(withMessages({ ...next, invites: db.invites.map((v) => v.id === inviteId ? updated : v) }, [message]));
      emitMessage(message);
      return inviteView(updated);
    },

    async cancelInvite(inviteId) {
      const invite = pendingInvite(inviteId, 'fromUserId');
      return replaceInvite({ ...invite, status: 'cancelled', respondedAt: new Date().toISOString() });
    },

    async markInvitesSeen(inviteIds) {
      const ids = new Set(inviteIds);
      if (!ids.size) return;
      commit({ ...db, invites: db.invites.map((v) => v.fromUserId === ME && ids.has(v.id) ? { ...v, seenByFrom: true } : v) });
    },

    async blockInviter(userId) {
      if (typeof userId !== 'string' || !userId) throw inviteError('invite_bad');
      if (db.inviteBlocks.some((b) => b.blocker === ME && b.blocked === userId)) return;
      commit({ ...db, inviteBlocks: [...db.inviteBlocks, { blocker: ME, blocked: userId, createdAt: new Date().toISOString() }] });
    },

    async unblockInviter(userId) {
      commit({ ...db, inviteBlocks: db.inviteBlocks.filter((b) => !(b.blocker === ME && b.blocked === userId)) });
    },

    async listBlocked() {
      return db.inviteBlocks.filter((b) => b.blocker === ME)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.blocked.localeCompare(b.blocked))
        .map((b) => ({ userId: b.blocked, createdAt: b.createdAt }));
    },

    async deletePost(post) {
      if (!db.posts.some((p) => p.id === post.id && p.userId === ME)) {
        throw new Error('글을 지우지 못했어요. 새로고침한 뒤 다시 확인해 주세요.');
      }
      commit({
        ...db,
        posts: db.posts.filter((p) => p.id !== post.id),
        postVerifications: db.postVerifications.filter((v) => v.postId !== post.id),
        postGroups: db.postGroups.filter((x) => x.postId !== post.id),
        reactions: db.reactions.filter((r) => r.postId !== post.id),
        comments: db.comments.filter((c) => c.postId !== post.id),
        invites: db.invites.map((v) => v.postId === post.id ? { ...v, postId: null } : v),
      });
    },

    async resetDemo() {
      if (deleted) throw inviteError('not_signed_in');
      for (const timer of replyTimers.values()) clearTimeout(timer);
      replyTimers.clear();
      threadListeners.clear();
      localStorage.removeItem(KEY);
      db = seed();
      save(db);
    },
  };
}

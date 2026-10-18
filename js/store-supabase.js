// 실제 모드 저장소 — Supabase(무료 요금제). 스키마·권한 규칙은 supabase/schema.sql.
// 로그인 없음: 기기마다 익명 계정 + 모임별 닉네임·4자리 번호(기기 바꿀 때 기록 되찾기용).
// v1.7: 모임·DM 채팅방(Realtime/폴링), 음식 종류/상위 %, 공개 미식가.
// v1.8: 공개 태그 차단, 읽음 경계, 월별 기록과 채팅 카드 조회.
// v1.9: 모든 기록의 익명 숫자 집계와 계정별 집계 제외.
// v2.0: 경험 인증 상태·그릇 수·익명 전문가 평점·리스트.
// v2.1: 공개 집계·고정 전문가 기준·되찾기 상한·기간별 전체 기록 조회.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const BUCKET = 'photos';
const PUBLIC_POST_COLUMNS = 'id, user_id, place, area, taste, worth, recommend, note, photo_path, eaten_on, created_at, menu, price, category, is_public';
const REACTION_KINDS = ['yum', 'want', 'like', 'lol'];
const CATEGORIES = ['pyeongyang_naengmyeon', 'naengmyeon', 'gukbap', 'donkatsu', 'ramen', 'sushi',
  'noodle', 'meat', 'chicken', 'pizza_burger', 'pasta', 'chinese', 'japanese', 'korean', 'western',
  'bunsik', 'seafood', 'cafe', 'bakery', 'dessert', 'bar', 'etc'];

const MESSAGES = [
  [/report_duplicate/, '이미 신고한 대상이에요.'],
  [/report_daily_limit/, '신고는 하루 20건까지 할 수 있어요.'],
  [/report_self/, '자신은 신고할 수 없어요.'],
  [/report_unavailable/, '이 모임에서 확인할 수 있는 대상만 신고할 수 있어요.'],
  [/bad_report/, '신고 내용을 다시 확인해 주세요.'],
  [/post_daily_limit/, '기록은 하루 20개까지 올릴 수 있어요.'],
  [/photo_daily_limit/, '사진은 하루 20장까지 올릴 수 있어요.'],
  [/photo_total_limit/, '사진은 총 300장까지 보관할 수 있어요. 먼저 기록을 지워 주세요.'],
  [/account_photos_remaining/, '사진 삭제를 마치지 못했어요. 다시 지우기를 눌러 주세요.'],
  [/account_deleting/, '계정 삭제 준비 중이에요. 설정에서 다시 지우거나 취소해 주세요.'],
  [/account_deletion_not_prepared/, '삭제 준비가 취소됐어요. 다시 지우려면 설정에서 시작해 주세요.'],
  [/bad_chat_block/, '같은 모임 친구만 차단할 수 있어요.'],
  [/duplicate_receipt/, '이미 쓴 영수증이에요.'],
  [/duplicate_photo/, '이미 올린 사진이에요.'],
  [/daily_limit/, '오늘은 이 종류를 더 인증할 수 없어요.'],
  [/mismatch/, '영수증이 이 기록과 안 맞아요.'],
  [/bad_list/, '리스트 내용을 다시 확인해 주세요.'],
  [/not_owner/, '본인 기록만 바꿀 수 있어요.'],
  [/group_not_found/, '그 초대 코드의 모임을 못 찾았어요. 코드를 다시 확인해 주세요.'],
  [/nickname_taken/, '이 모임에 같은 닉네임이 있어요. 본인이면 그때 정한 4자리 번호를 넣어 주세요.'],
  [/pin_rate_limited/, '번호를 5번 틀려서 15분 동안 잠겼어요. 잠시 뒤에 다시 해 주세요.'],
  [/reclaim_conflict/, '이 기기의 기록과 합칠 수 없어요. 원래 기기에서 확인해 주세요.'],
  [/reclaim_retry/, '잠시 뒤 다시 시도해 주세요.'],
  [/bad_pin/, '번호는 숫자 4자리로 정해 주세요.'],
  [/bad_name/, '이름은 1~30자, 닉네임은 1~12자로 적어 주세요.'],
  [/bad_menu/, '메뉴는 30자 이내로 적어 주세요.'],
  [/bad_price/, '1인 가격은 0~1,000,000원 사이의 정수로 적어 주세요.'],
  [/bad_with_users/, '같이 먹은 친구는 최대 10명까지 골라 주세요.'],
  [/bad_reaction/, '사용할 수 없는 반응이에요.'],
  [/bad_comment/, '댓글은 1~100자로 적어 주세요.'],
  [/comment_delete_failed/, '댓글을 지우지 못했어요. 본인 댓글인지 확인한 뒤 다시 해 주세요.'],
  [/reaction_change_failed/, '반응을 바꾸지 못했어요. 새로고침한 뒤 다시 해 주세요.'],
  [/invite_self/, '자기 자신에게는 보낼 수 없어요.'],
  [/invite_not_member/, '같은 모임 친구에게만 보낼 수 있어요.'],
  [/invite_unavailable/, '지금은 이 친구에게 보낼 수 없어요.'],
  [/invite_duplicate/, '이 친구에게 보낸 초대가 아직 답을 기다리고 있어요.'],
  [/invite_cooldown/, '이 친구는 얼마 전에 "이번엔 패스"라고 했어요. 7일 뒤에 다시 보낼 수 있어요.'],
  [/invite_too_many/, '답을 기다리는 초대가 너무 많아요. 몇 개를 정리한 뒤 보내 주세요.'],
  [/invite_bad/, '초대 내용을 다시 확인해 주세요.'],
  [/invite_closed/, '이미 답했거나 취소된 초대예요.'],
  [/bad_message/, '메시지는 1~300자로 보내 주세요.'],
  [/thread_closed/, '이 채팅방에는 보낼 수 없어요.'],
  [/bad_read_until/, '읽은 메시지 시각을 확인해 주세요.'],
  [/bad_handle/, '아이디는 영문 소문자·숫자·밑줄 3~20자예요.'],
  [/handle_taken/, '이미 있는 아이디예요.'],
  [/handle_immutable/, '아이디는 바꿀 수 없어요.'],
  [/no_public_profile/, '공개 프로필을 먼저 만들어 주세요.'],
  [/bad_public_profile/, '공개 이름은 1~20자, 소개는 80자까지 쓸 수 있어요.'],
  [/bad_category/, '음식 종류를 다시 골라 주세요.'],
  [/bad_month/, '월은 YYYY-MM 형식으로 골라 주세요.'],
  [/bad_date_range/, '조회할 날짜 범위를 다시 확인해 주세요.'],
  [/bad_stats_opt_out/, '통계 설정을 다시 확인해 주세요.'],
  [/bad_bio/, '소개는 60자까지 쓸 수 있어요.'],
  [/bad_poll/, '투표 내용을 다시 확인해 주세요.'],
  [/poll_closed/, '이미 끝난 투표예요.'],
  [/not_member/, '참여 중인 모임에서만 사용할 수 있어요.'],
  [/captcha/i, '사람인지 확인을 다시 해 주세요.'],
  [/not_signed_in|JWT|session/i, '접속이 끊겼어요. 새로고침해 주세요.'],
  [/[Aa]nonymous sign-ins are disabled/, '설정이 덜 됐어요: Supabase에서 익명 로그인을 켜 주세요(설정가이드 3번).'],
  [/Failed to fetch|NetworkError|network/i, '인터넷 연결을 확인해 주세요.'],
  [/row-level security|permission denied/i, '권한이 없어요. 모임에 들어간 뒤 다시 해 주세요.'],
];

function friendly(error) {
  const raw = [error?.message, error?.details, error?.hint, error?.code, error?.error,
    error?.originalError?.message, error?.cause?.message].filter((v) => typeof v === 'string').join(' ');
  const hit = MESSAGES.find(([re]) => re.test(raw));
  const e = new Error(hit ? hit[1] : `문제가 생겼어요 (${error?.message || '알 수 없음'})`);
  e.raw = raw;
  return e;
}

function photoError(error) {
  const e = friendly(error);
  if (/post_daily_limit|photo_daily_limit|photo_total_limit|account_deleting|not_signed_in|JWT|session/i.test(e.raw)) return e;
  if (/AccessDenied|Unauthorized|Forbidden|row-level security|permission denied/i.test(e.raw) || ['401', '403'].includes(String(error?.statusCode || error?.status))) {
    e.message = '사진을 올릴 권한을 확인하지 못했어요. 새로고침한 뒤 다시 해 주세요.';
  } else if (/EntityTooLarge|PayloadTooLarge|exceeded.*size/i.test(e.raw) || String(error?.statusCode) === '413') {
    e.message = '사진 크기가 너무 커요. 다른 사진을 골라 주세요.';
  } else if (/quota|storage.*limit|insufficient.*storage/i.test(e.raw) || String(error?.statusCode) === '507') {
    e.message = '사진 보관함 한도에 닿았어요. 잠시 뒤 다시 해 주세요.';
  } else if (MESSAGES.some(([re]) => re.test(e.raw))) {
    return e;
  } else {
    e.message = '사진 업로드 결과를 확인하지 못했어요. 연결을 확인해 주세요.';
  }
  return e;
}

const validText = (value, min, max) => typeof value === 'string'
  && [...value].length >= min && [...value].length <= max;

function pollInput(input) {
  const { title, options, closesAt = null } = input || {};
  if (!validText(typeof title === 'string' ? title.trim() : title, 1, 40) || !Array.isArray(options)
      || options.length < 2 || options.length > 6
      || options.some((o) => !o || !validText(typeof o.place === 'string' ? o.place.trim() : o.place, 1, 40)
        || !validText(o.area ?? '', 0, 20))
      || (closesAt !== null && (typeof closesAt !== 'string' || !Number.isFinite(Date.parse(closesAt))))) {
    throw friendly({ message: 'bad_poll' });
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
    throw friendly({ message: 'bad_list' });
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


export async function createSupabaseStore({ supabaseUrl, supabaseAnonKey, captchaSiteKey = '' }, { captchaToken = '' } = {}) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hanip-auth' },
  });

  let {
    data: { session },
  } = await sb.auth.getSession();
  // 가짜 가입 막기(Turnstile)가 켜져 있으면 확인 토큰을 받기 전까지 새 익명 계정을 만들지 않는다.
  // 이때 me()는 null이고, 시작 화면이 토큰을 받아 저장소를 다시 만든다.
  if (!session && (!captchaSiteKey || captchaToken)) {
    const { data, error } = await sb.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
    if (error) throw friendly(error);
    session = data.session;
  }
  let uid = session?.user.id ?? null;
  // 신고 내용은 서버에만, 숨김 번호는 이 브라우저에 계정별로 보관한다.
  const reportKey = 'hanip-reported-targets';
  let reported = [];
  const readReported = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(reportKey));
      if (saved?.userId === uid && Array.isArray(saved.targets)) {
        for (const row of saved.targets) {
          if (row && ['post', 'comment', 'message', 'member'].includes(row.targetType) && typeof row.targetId === 'string'
              && !reported.some((r) => r.targetType === row.targetType && r.targetId === row.targetId)) {
            reported.push({ targetType: row.targetType, targetId: row.targetId });
          }
        }
      }
    } catch { /* 읽기 실패 시 이번 방문의 숨김을 유지한다. */ }
    return reported.map((r) => ({ ...r }));
  };
  const rememberReport = ({ targetType, targetId }) => {
    readReported();
    if (!reported.some((r) => r.targetType === targetType && r.targetId === targetId)) reported.push({ targetType, targetId });
    try { localStorage.setItem(reportKey, JSON.stringify({ userId: uid, targets: reported })); }
    catch { /* 서버 접수 성공은 유지한다. */ }
  };

  const thumbPath = (path) => path.replace(/\.jpg$/, '.thumb.jpg');
  const photoPaths = (path) => [...new Set([path, thumbPath(path)])];
  const urlCache = new Map(); // 경로별 서명 URL, 만료 10분 전 갱신. 디스크에는 저장하지 않는다.
  const urlLoads = new Map(); // 같은 사진을 여러 화면에서 동시에 요청해도 서명은 한 번만.
  async function attachUrls(posts) {
    const now = Date.now();
    const paths = [...new Set(posts.flatMap((p) => p.photoPath ? photoPaths(p.photoPath) : []))];
    for (const [path, cached] of urlCache) if (cached.exp <= now) urlCache.delete(path);
    const need = paths.filter((path) => !urlCache.has(path) && !urlLoads.has(path));
    if (need.length) {
      const pending = Promise.resolve().then(async () => {
        try {
          const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 60 * 60);
          const rows = new Map((error ? [] : data || []).map((row) => [row.path, row]));
          for (const path of need) {
            const url = rows.get(path)?.signedUrl || null;
            // 옛 글의 작은 사진이 없거나 요청에 실패하면 잠시 원본으로 표시한다.
            urlCache.set(path, { url, exp: now + (url ? 50 * 60 : 30) * 1000 });
          }
        } catch {
          for (const path of need) urlCache.set(path, { url: null, exp: now + 30000 });
        } finally {
          for (const path of need) urlLoads.delete(path);
        }
      });
      for (const path of need) urlLoads.set(path, pending);
    }
    await Promise.all([...new Set(paths.map((path) => urlLoads.get(path)).filter(Boolean))]);
    for (const p of posts) {
      p.originalPhotoUrl = p.photoPath ? urlCache.get(p.photoPath)?.url || null : null;
      p.photoUrl = p.photoPath ? urlCache.get(thumbPath(p.photoPath))?.url || p.originalPhotoUrl : null;
    }
    return posts;
  }

  const mapPost = (r, extra = {}) => ({
    id: r.id, userId: r.user_id, nickname: r.nickname ?? '', place: r.place, area: r.area || '',
    taste: r.taste, worth: r.worth, recommend: r.recommend, note: r.note || '', photoPath: r.photo_path,
    photoUrl: null, eatenOn: r.eaten_on, createdAt: r.created_at, groupIds: [],
    menu: r.menu || '', price: r.price ?? null, withUserIds: [...(r.with_users || [])],
    category: r.category ?? null, isPublic: r.is_public === true,
    verified: r.verified === true, verifiedBy: [...(r.verified_by || [])],
    reactions: [], comments: [], ...extra,
  });
  const mapComment = (r) => ({ id: r.id, userId: r.user_id, body: r.body, createdAt: r.created_at });
  const mapMessage = (r) => ({
    id: r.id, threadId: r.thread_id, senderId: r.sender, kind: r.kind, body: r.body,
    inviteId: r.invite_id ?? null, pollId: r.poll_id ?? null, createdAt: r.created_at,
  });
  const mapThread = (r) => ({
    id: r.id, groupId: r.group_id, kind: r.kind, otherUserId: r.other_user_id ?? null,
    lastMessage: r.last_message ?? null, unread: Number(r.unread || 0), lastMessageAt: r.last_message_at,
  });
  const mapNamed = (r) => ({
    userId: r.user_id, handle: r.handle, displayName: r.display_name, bio: r.bio || '',
    verified: r.verified === true, badge: r.badge ?? null, followers: Number(r.followers || 0),
    postCount: Number(r.post_count || 0), topCategory: r.top_category ?? null, isFollowing: r.is_following === true,
  });
  const mapPoll = (r, votes = []) => ({
    id: r.id, groupId: r.group_id, creatorId: r.creator, title: r.title,
    options: r.options.map(({ place, area }) => ({ place, area: area || '' })),
    votes: votes.map((v) => ({ userId: v.user_id, optionIdx: v.option_idx })),
    closesAt: r.closes_at ?? null,
    closed: r.closed === true || (r.closes_at != null && Date.parse(r.closes_at) <= Date.now()),
    createdAt: r.created_at,
  });
  const mapInvite = (r) => ({
    id: r.id, groupId: r.group_id, threadId: r.thread_id ?? null, fromUserId: r.from_user, toUserId: r.to_user,
    place: r.place, area: r.area || '', postId: r.post_id ?? null, message: r.message || '',
    choices: (r.choices || []).map(({ key, label }) => ({ key, label })), status: r.status,
    picked: r.picked ?? null, replyNote: r.reply_note || '', createdAt: r.created_at,
    respondedAt: r.responded_at ?? null, seenByFrom: r.seen_by_from === true,
  });
  async function inviteRpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw friendly(error);
    return mapInvite(data);
  }

  // 댓글·반응은 글보다 많을 수 있다. 서버의 행 수 제한에 잘리지 않도록 안정된 순서로 나눠 읽는다.
  async function readAll(makeQuery) {
    const rows = [];
    for (;;) {
      const { data, error } = await makeQuery().range(rows.length, rows.length + 499);
      if (error) throw friendly(error);
      if (!data?.length) return rows;
      rows.push(...data);
    }
  }

  async function readByIds(makeQuery, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    const rows = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const batch = unique.slice(offset, offset + 50);
      rows.push(...await readAll(() => makeQuery().in('id', batch)
        .order('created_at', { ascending: false }).order('id', { ascending: false })));
    }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }

  async function namedRows(args = {}) {
    const rows = await readAll(() => sb.rpc('list_named', args));
    return rows.map(mapNamed);
  }

  async function attachVerifiedUrls(posts) {
    for (let offset = 0; offset < posts.length; offset += 100) {
      const batch = posts.slice(offset, offset + 100);
      const { data, error } = await sb.rpc('post_verification_status', { p_posts: batch.map((p) => p.id) });
      if (error) throw friendly(error);
      const statuses = new Map((data || []).map((r) => [r.post_id, r]));
      for (const p of batch) {
        const status = statuses.get(p.id);
        p.verified = status?.verified === true;
        p.verifiedBy = [...(status?.verified_by || [])];
      }
    }
    return attachUrls(posts);
  }

  async function bowls(userId) {
    const { data, error } = await sb.rpc('user_bowls', { p_user: userId });
    if (error) throw friendly(error);
    return (data || []).map((r) => ({ category: r.category, verified: Number(r.verified), total: Number(r.total) }));
  }

  async function attachVotes(rows) {
    if (!rows.length) return [];
    const votes = [];
    for (let offset = 0; offset < rows.length; offset += 50) {
      const ids = rows.slice(offset, offset + 50).map((r) => r.id);
      votes.push(...await readAll(() => sb.from('polls_votes').select('poll_id, user_id, option_idx')
        .in('poll_id', ids).order('poll_id').order('user_id')));
    }
    return rows.map((r) => mapPoll(r, votes.filter((v) => v.poll_id === r.id)));
  }

  async function pollRpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw friendly(error);
    return (await attachVotes([data]))[0];
  }

  const messageQuery = (threadId) => sb.from('messages')
    .select('id, thread_id, sender, kind, body, invite_id, poll_id, created_at').eq('thread_id', threadId);
  async function listMessages(threadId) {
    // 긴 대화도 최근 200개를 시간순으로 보여 준다.
    const { data, error } = await messageQuery(threadId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200);
    if (error) throw friendly(error);
    return (data || []).reverse().map(mapMessage);
  }

  function subscribeThread(threadId, onMessage) {
    let stopped = false;
    let channel = null;
    let pollTimer = null;
    let watchdog = null;
    let ready = false;
    let busy = false;
    let cursor = null;
    const seen = new Set();
    const deliver = (message) => {
      if (stopped || seen.has(message.id)) return;
      seen.add(message.id);
      try { onMessage(message); } catch (error) { console.warn('채팅 수신 처리 실패', error); }
    };
    async function baseline() {
      const rows = await listMessages(threadId);
      if (stopped) return;
      for (const row of rows) seen.add(row.id);
      cursor = rows.at(-1)?.createdAt ?? null;
      ready = true;
    }
    async function poll() {
      if (stopped || busy) return;
      busy = true;
      try {
        if (!ready) await baseline();
        if (stopped) return;
        const rows = await readAll(() => {
          let query = messageQuery(threadId).order('created_at').order('id');
          // 같은 시각의 메시지도 빠뜨리지 않고 ID로 중복을 제거한다.
          if (cursor !== null) query = query.gte('created_at', cursor);
          return query;
        });
        for (const row of rows) deliver(mapMessage(row));
        if (rows.length) cursor = rows.at(-1).created_at;
      } catch (error) {
        if (!stopped) console.warn('채팅 새 메시지 조회 실패', error);
        startPolling();
      } finally {
        busy = false;
      }
    }
    const stopPolling = () => {
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = () => {
      if (stopped || pollTimer !== null) return;
      pollTimer = setInterval(() => { void poll(); }, 5000);
      void poll();
    };
    async function start() {
      try { await baseline(); } catch (error) {
        if (!stopped) console.warn('채팅 초기 조회 실패', error);
        startPolling();
      }
      if (stopped) return;
      try {
        channel = sb.channel(`thread-chat:${threadId}:${crypto.randomUUID()}`);
        watchdog = setTimeout(startPolling, 10000);
        channel.on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}`,
        }, ({ new: row }) => deliver(mapMessage(row))).subscribe((status) => {
          if (stopped) return;
          clearTimeout(watchdog);
          if (status === 'SUBSCRIBED') {
            stopPolling();
            void poll(); // 조회와 연결 사이 또는 재연결 중에 도착한 메시지 보충
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            startPolling();
          }
        });
      } catch (error) {
        if (!stopped) console.warn('채팅 실시간 연결 실패', error);
        startPolling();
      }
    }
    void start();
    return () => {
      if (stopped) return;
      stopped = true;
      stopPolling();
      clearTimeout(watchdog);
      if (channel) {
        Promise.resolve().then(() => sb.removeChannel(channel))
          .catch((error) => console.warn('채팅 구독 해제 실패', error));
      }
    };
  }

  return {
    mode: 'supabase',
    async photoUrls(posts) { return attachUrls(posts); },
    me: () => uid,

    async getMyAccountDeletion() {
      const { data, error } = await sb.rpc('get_my_account_deletion');
      if (error) throw friendly(error);
      return data === true;
    },

    async cancelMyAccountDeletion() {
      const { error } = await sb.rpc('cancel_my_account_deletion');
      if (error) throw friendly(error);
    },

    async deleteMyAccount() {
      // SQL DELETE on storage.objects leaves the actual file orphaned. Use the Storage API.
      const { data: paths, error: prepareError } = await sb.rpc('prepare_my_account_deletion');
      if (prepareError) throw friendly(prepareError);
      for (let i = 0; i < (paths || []).length; i += 100) {
        const { error } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (error) throw friendly({ message: 'account_photos_remaining' });
      }
      const { error } = await sb.rpc('delete_my_account');
      if (error) throw friendly(error);
      // The account is gone even if revoking an already deleted session fails.
      uid = null;
      urlCache.clear();
      try { await sb.removeAllChannels(); } catch { /* local cleanup continues */ }
      try { await sb.auth.signOut({ scope: 'local' }); } catch { /* remove persisted tokens below */ }
      for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
        if (!storage) continue;
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (key?.startsWith('hanip-')) storage.removeItem(key);
        }
      }
    },

    async listReportedTargets() { return uid ? readReported() : []; },

    async reportContent(input = {}) {
      const { groupId, targetType, targetId, targetUser, reason, memo = '' } = input || {};
      if (!uid) throw friendly({ message: 'not_signed_in' });
      if (![groupId, targetId, targetUser].every((v) => typeof v === 'string' && v.trim())
          || !['post', 'comment', 'message', 'member'].includes(targetType)
          || !['스팸·광고', '욕설·괴롭힘', '음란·폭력', '개인정보 노출', '기타'].includes(reason)
          || !validText(memo, 0, 200)) throw friendly({ message: 'bad_report' });
      const { data, error } = await sb.rpc('report_content', { p_group: groupId, p_target_type: targetType,
        p_target_id: targetId, p_target_user: targetUser, p_reason: reason, p_memo: memo.trim() });
      if (error) {
        if (/report_duplicate/.test(error.message || '')) rememberReport({ targetType, targetId });
        throw friendly(error);
      }
      rememberReport({ targetType, targetId });
      return data;
    },

    async blockChatUser(userId) {
      const { error } = await sb.rpc('set_chat_block', { p_user: userId, p_block: true });
      if (error) throw friendly(error);
    },

    async unblockChatUser(userId) {
      const { error } = await sb.rpc('set_chat_block', { p_user: userId, p_block: false });
      if (error) throw friendly(error);
    },

    async listChatBlocked() {
      const { data, error } = await sb.from('chat_blocks').select('blocked, created_at')
        .eq('blocker', uid).is('ended_at', null).order('created_at', { ascending: false });
      if (error) throw friendly(error);
      return (data || []).map((b) => ({ userId: b.blocked, createdAt: b.created_at }));
    },

    async verifyPost(postId, input = {}) {
      const v = verificationInput(input);
      const { data, error } = await sb.rpc('verify_post', {
        p_post: postId, p_receipt_hash: v.receiptHash, p_receipt_store: v.receiptStore,
        p_receipt_date: v.receiptDate, p_photo_hash: v.photoHash,
        p_ai_category: v.aiCategory, p_ai_confidence: v.aiConfidence,
      });
      if (error) throw friendly(error);
      return { verified: data.verified === true, reason: data.reason ?? null };
    },

    async myBowls() { return bowls(uid); },
    async userBowls(userId) { return bowls(userId); },

    async expertRating(place, category, minBowls = 50) {
      if (!CATEGORIES.includes(category)) throw friendly({ message: 'bad_category' });
      if (!validText(typeof place === 'string' ? place.trim() : place, 1, 40)
          || minBowls !== 50) return null;
      const { data, error } = await sb.rpc('expert_rating', { p_place: place, p_category: category, p_min_bowls: minBowls });
      if (error) throw friendly(error);
      return data == null ? null : { raters: Number(data.raters), taste: Number(data.taste), worth: Number(data.worth),
        recommend: Number(data.recommend), minBowls: Number(data.minBowls) };
    },

    async listLists({ scope = 'mine', groupId = null } = {}) {
      if (!['mine', 'group', 'public'].includes(scope)) throw friendly({ message: 'bad_list' });
      const { data, error } = await sb.rpc('list_lists', { p_scope: scope, p_group: groupId });
      if (error) throw friendly(error);
      return data || [];
    },

    async getList(id) {
      const { data, error } = await sb.rpc('get_list', { p_id: id });
      if (error) throw friendly(error);
      return data ?? null;
    },

    async saveList(input) {
      const v = listInput(input);
      const { data, error } = await sb.rpc('save_list', { p_id: v.id, p_group: v.groupId, p_is_public: v.isPublic,
        p_title: v.title, p_description: v.description, p_items: v.items });
      if (error) throw friendly(error);
      return data;
    },

    async deleteList(id) {
      const { error } = await sb.rpc('delete_list', { p_id: id });
      if (error) throw friendly(error);
    },

    async listMyGroups() {
      if (!uid) return [];
      const { data: mine, error } = await sb
        .from('members')
        .select('group_id, nickname, groups(id, name, code, created_at)')
        .eq('user_id', uid);
      if (error) throw friendly(error);
      if (!mine.length) return [];
      const ids = mine.map((m) => m.group_id);
      const { data: all, error: e2 } = await sb
        .from('members')
        .select('group_id, user_id, nickname, bio, joined_at')
        .in('group_id', ids)
        .order('joined_at');
      if (e2) throw friendly(e2);
      return mine
        .filter((m) => m.groups)
        .sort((a, b) => a.groups.created_at.localeCompare(b.groups.created_at))
        .map((m) => ({
          id: m.groups.id, name: m.groups.name, code: m.groups.code, myNickname: m.nickname,
          members: all.filter((x) => x.group_id === m.group_id)
            .map((x) => ({ userId: x.user_id, nickname: x.nickname, bio: x.bio || '' })),
        }));
    },

    async setBio(groupId, bio) {
      if (bio !== null && !validText(typeof bio === 'string' ? bio.trim() : bio, 0, 60)) {
        throw friendly({ message: 'bad_bio' });
      }
      const { error } = await sb.rpc('set_bio', { p_group: groupId, p_bio: bio?.trim() || null });
      if (error) throw friendly(error);
    },

    listMessages,
    subscribeThread,

    async listThreads() {
      const rows = await readAll(() => sb.rpc('list_threads')
        .order('last_message_at', { ascending: false }).order('id'));
      return rows.map(mapThread);
    },

    async openDm(groupId, otherUserId) {
      const { data: id, error } = await sb.rpc('open_dm', { p_group: groupId, p_other: otherUserId });
      if (error) throw friendly(error);
      const { data, error: e2 } = await sb.rpc('list_threads').eq('id', id).maybeSingle();
      if (e2) throw friendly(e2);
      if (!data) throw friendly({ message: 'thread_closed' });
      return mapThread(data);
    },

    async sendMessage(threadId, body) {
      if (!validText(typeof body === 'string' ? body.trim() : body, 1, 300)) {
        throw friendly({ message: 'bad_message' });
      }
      const { data, error } = await sb.rpc('send_message', { p_thread: threadId, p_body: body.trim() });
      if (error) throw friendly(error);
      return mapMessage(data);
    },

    async markThreadRead(threadId, until) {
      if (until == null) return;
      if (typeof until !== 'string' || !Number.isFinite(Date.parse(until))) throw friendly({ message: 'bad_read_until' });
      const { error } = await sb.rpc('mark_thread_read', { p_thread: threadId, p_until: until });
      if (error) throw friendly(error);
    },

    async unreadTotal() {
      const { data, error } = await sb.rpc('unread_total');
      if (error) throw friendly(error);
      return Number(data || 0);
    },

    async getStatsOptOut() {
      const { data, error } = await sb.from('user_prefs').select('stats_opt_out').eq('user_id', uid).limit(1);
      if (error) throw friendly(error);
      return data?.[0]?.stats_opt_out === true;
    },

    async setStatsOptOut(optOut) {
      if (typeof optOut !== 'boolean') throw friendly({ message: 'bad_stats_opt_out' });
      const { error } = await sb.rpc('set_stats_opt_out', { p_opt_out: optOut });
      if (error) throw friendly(error);
    },

    async categoryRank(category, ym) {
      const { data, error } = await sb.rpc('category_rank', { p_category: category, p_month: ym });
      if (error) throw friendly(error);
      return { users: data.users == null ? null : Number(data.users), myCount: Number(data.myCount),
        topPercent: data.topPercent == null ? null : Number(data.topPercent), optedOut: data.optedOut === true };
    },

    async listNamed({ sort = 'followers' } = {}) {
      return namedRows({ p_sort: sort === 'new' ? 'new' : 'followers' });
    },

    async getNamed(handle) {
      const [profile] = await namedRows({ p_handle: handle });
      if (!profile) return { profile: null, posts: [] };
      const { data, error } = await sb.from('posts').select(PUBLIC_POST_COLUMNS)
        .eq('user_id', profile.userId).eq('is_public', true)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (error) throw friendly(error);
      return { profile, posts: await attachVerifiedUrls((data || []).map((p) => mapPost(p, { nickname: profile.displayName, withUserIds: [] }))) };
    },

    async follow(userId) {
      const { error } = await sb.from('follows').upsert({ follower: uid, followee: userId }, {
        onConflict: 'follower,followee', ignoreDuplicates: true,
      });
      if (error) throw friendly(error);
    },

    async unfollow(userId) {
      const { error } = await sb.from('follows').delete().eq('follower', uid).eq('followee', userId);
      if (error) throw friendly(error);
    },

    async myPublicProfile() {
      return (await namedRows({ p_user: uid }))[0] ?? null;
    },

    async savePublicProfile({ handle, displayName, bio = '' }) {
      const { error } = await sb.rpc('save_public_profile', {
        p_handle: handle, p_display_name: displayName, p_bio: bio,
      });
      if (error) throw friendly(error);
      return (await namedRows({ p_user: uid }))[0] ?? null;
    },

    async followingFeed() {
      const { data, error } = await sb.rpc('following_feed');
      if (error) throw friendly(error);
      if (!data?.length) return [];
      const { data: profiles, error: e2 } = await sb.from('public_profiles')
        .select('user_id, display_name').in('user_id', [...new Set(data.map((r) => r.user_id))]);
      if (e2) throw friendly(e2);
      const names = new Map((profiles || []).map((p) => [p.user_id, p.display_name]));
      return attachUrls(data.map((p) => mapPost(p, { nickname: names.get(p.user_id) || '', withUserIds: [] })));
    },

    async listPolls(groupId, ids = null) {
      if (ids !== null) {
        return attachVotes(await readByIds(() => sb.from('polls').select('*').eq('group_id', groupId), ids));
      }
      const { data, error } = await sb.from('polls').select('*').eq('group_id', groupId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30);
      if (error) throw friendly(error);
      return attachVotes(data || []);
    },

    async createPoll(groupId, input) {
      const { title, options, closesAt } = pollInput(input);
      return pollRpc('create_poll', { p_group: groupId, p_title: title, p_options: options, p_closes_at: closesAt });
    },

    async votePoll(pollId, optionIdx) {
      if (optionIdx !== null && (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 5)) {
        throw friendly({ message: 'bad_poll' });
      }
      return pollRpc('vote_poll', { p_poll: pollId, p_idx: optionIdx });
    },

    async closePoll(pollId) {
      return pollRpc('close_poll', { p_poll: pollId });
    },

    async createGroup(name, nickname, pin) {
      const { data, error } = await sb.rpc('create_group', { p_name: name, p_nickname: nickname, p_pin: pin });
      if (error) throw friendly(error);
      return data;
    },

    async joinGroup(code, nickname, pin) {
      const { data, error } = await sb.rpc('join_group', { p_code: code, p_nickname: nickname, p_pin: pin });
      if (error) throw friendly(error);
      if (data?.error) throw friendly({ message: data.error }); // 번호 틀림·잠김은 예외 대신 값으로 온다
      return data; // status: joined | already | reclaimed
    },

    async groupFeed(groupId, since) {
      const { data, error } = await sb.rpc('group_feed', { p_group: groupId, p_since: since });
      if (error) throw friendly(error);
      const posts = (data || []).map((r) => mapPost(r));
      if (!posts.length) return posts;
      const byId = new Map(posts.map((p) => [p.id, p]));
      // 피드가 실제 돌려준 글만 읽는다. URL 길이는 50개로 제한하고 각 묶음도 끝까지 페이징한다.
      const postIds = [...byId.keys()];
      for (let offset = 0; offset < postIds.length; offset += 50) {
        const ids = postIds.slice(offset, offset + 50);
        const [reactions, comments] = await Promise.all([
          readAll(() => sb.from('reactions')
            .select('post_id, user_id, kind')
            .eq('group_id', groupId).in('post_id', ids)
            .order('created_at').order('post_id').order('user_id').order('kind')),
          readAll(() => sb.from('comments')
            .select('id, post_id, user_id, body, created_at')
            .eq('group_id', groupId).in('post_id', ids)
            .order('created_at').order('id')),
        ]);
        for (const r of reactions) byId.get(r.post_id)?.reactions.push({ userId: r.user_id, kind: r.kind });
        for (const c of comments) byId.get(c.post_id)?.comments.push(mapComment(c));
      }
      return attachUrls(posts);
    },

    async myPosts() {
      const { data, error } = await sb
        .from('posts')
        .select('*, post_groups(group_id)')
        .eq('user_id', uid)
        .order('eaten_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw friendly(error);
      return attachVerifiedUrls(
        data.map((r) => mapPost(r, { nickname: '나', groupIds: (r.post_groups || []).map((x) => x.group_id) })),
      );
    },

    // from 포함, to 제외. 챌린지의 과거 동네와 시즌 기록도 500개 제한 없이 읽는다.
    async myPostsInRange(from, to) {
      const validDate = (date) => typeof date === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$/.test(date)
        && !date.startsWith('0000') && Number.isFinite(Date.parse(date))
        && new Date(date).toISOString().slice(0, 10) === date;
      if (!validDate(from) || !validDate(to) || from > to) throw friendly({ message: 'bad_date_range' });
      const rows = await readAll(() => sb.from('posts').select('*, post_groups(group_id)')
        .eq('user_id', uid).gte('eaten_on', from).lt('eaten_on', to)
        .order('eaten_on', { ascending: false }).order('created_at', { ascending: false }).order('id'));
      return attachVerifiedUrls(rows.map((r) => mapPost(r, { nickname: '나', groupIds: (r.post_groups || []).map((x) => x.group_id) })));
    },

    async myPostsInMonth(ym) {
      if (typeof ym !== 'string' || ym.length !== 7 || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(ym) || ym.startsWith('0000')) {
        throw friendly({ message: 'bad_month' });
      }
      const [year, month] = ym.split('-').map(Number);
      const next = month === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${ym.slice(0, 4)}-${String(month + 1).padStart(2, '0')}`;
      const rows = await readAll(() => sb.from('posts').select('*, post_groups(group_id)')
        .eq('user_id', uid).gte('eaten_on', `${ym}-01`).lt('eaten_on', `${next}-01`)
        .order('eaten_on', { ascending: false }).order('created_at', { ascending: false }).order('id'));
      return attachVerifiedUrls(rows.map((r) => mapPost(r, { nickname: '나', groupIds: (r.post_groups || []).map((x) => x.group_id) })));
    },

    async createPost(input) {
      const category = input.category ?? null;
      const isPublic = input.isPublic ?? false;
      if (category !== null && !CATEGORIES.includes(category)) throw friendly({ message: 'bad_category' });
      if (typeof isPublic !== 'boolean') throw friendly({ message: 'bad_public_profile' });
      const menu = input.menu ?? '';
      const price = input.price ?? null;
      const withUserIds = input.withUserIds ?? [];
      if (typeof menu !== 'string' || [...menu.trim()].length > 30) throw friendly({ message: 'bad_menu' });
      if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1000000)) {
        throw friendly({ message: 'bad_price' });
      }
      if (!Array.isArray(withUserIds) || withUserIds.length > 10
          || withUserIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw friendly({ message: 'bad_with_users' });
      }
      const id = crypto.randomUUID();
      const { error: limitError } = await sb.rpc('check_my_upload_limits', { p_photo: Boolean(input.photoBlob) });
      if (limitError) throw friendly(limitError);
      let path = null;
      const uploaded = [];
      if (input.photoBlob) {
        path = `${uid}/${id}.jpg`;
        const variants = [[path, input.photoBlob], ...(input.photoThumbBlob ? [[thumbPath(path), input.photoThumbBlob]] : [])];
        try {
          for (const [photoPath, blob] of variants) {
            const { error } = await sb.storage.from(BUCKET).upload(photoPath, blob, {
              contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
            });
            if (error) throw error;
            uploaded.push(photoPath);
          }
        } catch (error) {
          let failure = photoError(error);
          // Storage가 DB 원인을 감추는 경우에만 원장을 다시 확인한다.
          // 작은 사진은 원본의 한도를 이미 썼으므로 여기서 20/300으로 오진하지 않는다.
          if (!uploaded.length && !/photo_daily_limit|photo_total_limit|account_deleting/.test(failure.raw)) {
            try {
              const { error: limitError } = await sb.rpc('check_my_upload_limits', { p_photo: true });
              const checked = friendly(limitError);
              if (limitError && /post_daily_limit|photo_daily_limit|photo_total_limit|account_deleting|not_signed_in/.test(checked.raw)) failure = checked;
            } catch { /* 원장 조회 실패가 최초 오류를 가리지 않는다. */ }
          }
          if (uploaded.length) {
            try {
              const { error: cleanErr } = await sb.storage.from(BUCKET).remove(uploaded);
              if (cleanErr) console.warn('사진 정리 실패', cleanErr);
            } catch (cleanErr) { console.warn('사진 정리 실패', cleanErr); }
          }
          throw failure;
        }
      }
      // 글과 공유 모임을 서버에서 한 번에 저장(한쪽만 남는 일 없음)
      const { error: e1 } = await sb.rpc('create_post', {
        p_id: id, p_place: input.place, p_area: input.area || '', p_taste: input.taste, p_worth: input.worth,
        p_recommend: input.recommend, p_note: input.note || '', p_photo_path: path, p_eaten_on: input.eatenOn,
        p_category: category, p_is_public: isPublic,
        p_groups: input.groupIds || [], p_menu: menu.trim() || null, p_price: price, p_with_users: isPublic ? [] : [...withUserIds],
      });
      if (e1) {
        if (path) {
          const { error: cleanErr } = await sb.storage.from(BUCKET).remove(uploaded);
          if (cleanErr) console.warn('사진 정리 실패', cleanErr);
        }
        throw friendly(e1);
      }
      return id;
    },

    async toggleReaction(groupId, postId, kind) {
      if (!REACTION_KINDS.includes(kind)) throw friendly({ message: 'bad_reaction' });
      const ownReaction = () => sb.from('reactions');
      const match = (query) => query.eq('group_id', groupId).eq('post_id', postId).eq('user_id', uid).eq('kind', kind);
      const { data: existing, error } = await match(ownReaction().select('post_id')).maybeSingle();
      if (error) throw friendly(error);
      if (existing) {
        const { data: deleted, error: deleteError } = await match(ownReaction().delete()).select('post_id');
        if (deleteError) throw friendly(deleteError);
        if (deleted?.length !== 1) throw friendly({ message: 'reaction_change_failed' });
        return { on: false };
      }
      const { error: insertError } = await ownReaction().insert({ group_id: groupId, post_id: postId, user_id: uid, kind });
      if (insertError) throw friendly(insertError);
      return { on: true };
    },

    async addComment(groupId, postId, body) {
      if (typeof body !== 'string' || [...body.trim()].length < 1 || [...body.trim()].length > 100) {
        throw friendly({ message: 'bad_comment' });
      }
      const { data, error } = await sb.from('comments')
        .insert({ group_id: groupId, post_id: postId, user_id: uid, body: body.trim() })
        .select('id, user_id, body, created_at').single();
      if (error) throw friendly(error);
      return mapComment(data);
    },

    async deleteComment(commentId) {
      const { data: deleted, error } = await sb.from('comments').delete()
        .eq('id', commentId).eq('user_id', uid).select('id');
      if (error) throw friendly(error);
      if (deleted?.length !== 1) throw friendly({ message: 'comment_delete_failed' });
    },

    async myWants() {
      const data = await readAll(() => sb.from('reactions')
        .select('group_id, post_id, created_at, posts!inner(place, area, photo_path)')
        .eq('user_id', uid).eq('kind', 'want')
        .order('created_at', { ascending: false }).order('group_id').order('post_id'));
      const wants = await attachUrls(data.map((r) => ({
        groupId: r.group_id, postId: r.post_id, place: r.posts.place, area: r.posts.area || '',
        photoPath: r.posts.photo_path, createdAt: r.created_at,
      })));
      return wants.map(({ photoPath, ...want }) => want);
    },

    async removeWant(groupId, postId) {
      const { error } = await sb.rpc('remove_want', { p_group: groupId, p_post: postId });
      if (error) throw friendly(error);
    },

    async listInvites(ids = null) {
      // 카드 참조 조회도 테이블 RLS로 당사자·차단 조건을 검사한다.
      if (ids !== null) return (await readByIds(() => sb.from('invites').select('*'), ids)).map(mapInvite);
      // 차단 필터 적용 후 최신 200개와 그 밖의 대기·확정·보낸 초대의 미확인 답변을 돌려준다.
      const { data, error } = await sb.rpc('list_invites');
      if (error) throw friendly(error);
      return (data || []).map(mapInvite);
    },

    async sendInvite({ groupId, toUserId, place, area = '', postId = null, message = '', choices }) {
      return inviteRpc('send_invite', {
        p_group: groupId, p_to_user: toUserId, p_place: place, p_area: area,
        p_post_id: postId, p_message: message, p_choices: choices,
      });
    },

    async respondInvite(inviteId, status, picked = null, replyNote = '') {
      return inviteRpc('respond_invite', {
        p_invite: inviteId, p_status: status, p_picked: picked, p_reply_note: replyNote,
      });
    },

    async cancelInvite(inviteId) {
      return inviteRpc('cancel_invite', { p_invite: inviteId });
    },

    async markInvitesSeen(inviteIds) {
      if (!inviteIds.length) return;
      const { error } = await sb.rpc('mark_invites_seen', { p_invites: inviteIds });
      if (error) throw friendly(error);
    },

    async blockInviter(userId) {
      const { error } = await sb.from('invite_blocks').upsert({ blocker: uid, blocked: userId }, {
        onConflict: 'blocker,blocked', ignoreDuplicates: true,
      });
      if (error) throw friendly(error);
    },

    async unblockInviter(userId) {
      const { error } = await sb.from('invite_blocks').delete().eq('blocker', uid).eq('blocked', userId);
      if (error) throw friendly(error);
    },

    async listBlocked() {
      const data = await readAll(() => sb.from('invite_blocks').select('blocked, created_at')
        .eq('blocker', uid).order('created_at', { ascending: false }).order('blocked'));
      return data.map((r) => ({ userId: r.blocked, createdAt: r.created_at }));
    },

    async deletePost(post) {
      // 사진 먼저 — 사진 삭제가 실패하면 글도 지우지 않는다(다시 시도할 수 있게)
      if (post.photoPath) {
        const paths = photoPaths(post.photoPath);
        const { error: pe } = await sb.storage.from(BUCKET).remove(paths);
        if (pe) throw friendly(pe);
        for (const path of paths) urlCache.delete(path);
      }
      const { data: deleted, error } = await sb.from('posts').delete().eq('id', post.id).select('id');
      if (error) throw friendly(error);
      // 권한이 없어 0건 지워진 경우도 실패로 알린다(다른 기기에서 되찾기가 끝난 경우 등)
      if (deleted?.length !== 1) throw new Error('글을 지우지 못했어요. 새로고침한 뒤 다시 확인해 주세요.');
    },
  };
}

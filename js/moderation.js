// 숨김은 표시 목록에만 적용한다. 원본 데이터와 모임 집계는 바꾸지 않는다.
export const REPORT_REASONS = ['스팸·광고', '욕설·괴롭힘', '음란·폭력', '개인정보 노출', '기타'];
export const REPORT_TYPES = ['post', 'comment', 'message', 'member'];

export function reportInput(input = {}) {
  const { groupId, targetType, targetId, targetUser, reason, memo = '' } = input || {};
  if (![groupId, targetId, targetUser].every((v) => typeof v === 'string' && v.trim())
      || !REPORT_TYPES.includes(targetType) || !REPORT_REASONS.includes(reason)
      || typeof memo !== 'string' || [...memo].length > 200) {
    const error = new Error('신고 내용을 다시 확인해 주세요.');
    error.raw = 'bad_report';
    throw error;
  }
  return { groupId, targetType, targetId, targetUser, reason, memo: memo.trim() };
}

export function contentHidden(type, item, { blocked = [], reported = [] } = {}) {
  const id = type === 'member' ? item.userId : item.id;
  const user = item.userId ?? item.senderId;
  // 차단한 프로필은 차단을 풀 수 있게 유지한다. 신고한 프로필은 숨긴다.
  return (type !== 'member' && blocked.some((b) => b.userId === user))
    || reported.some((r) => r.targetType === type && r.targetId === id);
}

export function visibleContent(type, items, moderation) {
  return items.filter((item) => !contentHidden(type, item, moderation));
}

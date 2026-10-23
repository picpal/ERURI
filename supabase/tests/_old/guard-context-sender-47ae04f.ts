// 47ae04f 사본(E2 수정 전 guardContextSender) — 옛/새 차분 테스트 전용(E2 재리뷰 1: 가드는 INTENT 회귀 양쪽에 같이 걸려 회귀를 못 본다), 고치지 않는다
import type { ContextTurn, MailReadFields } from "../../functions/chat/filters.ts";

const NAME_BEFORE_MARK = /(?<![가-힣A-Za-z0-9._@+-])([가-힣A-Za-z0-9][가-힣A-Za-z0-9._@+-]*?)(?:\s*(?:거|것|꺼|걸)(?:로|를|을|는|은|도|만|랑|이랑|하고)?(?=$|[\s,.!?])|\s*쪽(?=$|[\s,.!?]|으로|에서)|(?:에서|한테서|에게서|한테|에게)(?=$|[\s,.!?])|\s+이?메일|(이랑|랑)(?=\s)|(?<!이)메일)/g;
const NOT_NAME = new Set(["그거", "이거", "저거", "그것", "이것", "저것", "거기", "여기", "저기", "그쪽", "이쪽", "저쪽", "아까", "방금", "최근", "가장", "제일", "마지막",
  "마지막으로", "처음", "어제", "오늘", "그제", "그저께", "엊그제", "지난주", "이번주", "지난달", "이번달", "이번", "지난", "저번", "다음", "다른", "새로", "같은", "해당",
  "아래", "나머지", "받은", "보낸", "들어간", "들어온", "광고", "프로모션", "안읽은", "읽은", "영어", "영문", "한글", "한국어", "우리말", "전체", "모든", "전부", "그런",
  "이런", "저런", "무슨", "어떤", "어느", "누구", "메일", "이메일", "편지", "아니", "말고", "하나",
  // G1 r3: 위치말·메일함류·제목에 흔한 일반 명사(맥락 후속 "위에 거·메일함에서 그거·안내 메일"이 맞는 맥락 발신자를 덮어썼다)
  "위", "위에", "위의", "윗", "앞", "앞에", "앞의", "뒤", "뒤에", "뒤의", "밑", "밑에", "아래에", "아랫", "앞서", "먼저", "다시", "그냥", "좀",
  "메일함", "편지함", "받은편지함", "보낸편지함", "스팸함", "스팸", "휴지통", "gmail", "지메일", "inbox", "메일박스",
  "안내", "보안", "공지", "알림", "결제", "청구", "명세서", "영수증", "주문", "배송", "인증", "예약", "확인", "초대", "이벤트", "할인", "쿠폰", "중요", "답장", "첨부"]);
// 관형형(~한·~은·~던·~준 등 — "요약한 거·말한 거·중요한 거·보여준 거")으로 끝나는 말은 이름이 아니다. 이 글자로 끝나는 실제 이름("신한 거")은 가드를 건너뛰어 모델 출력이 그대로 간다
const ADNOMINAL = /[한은는던된준낸온운린진쓴든본간할될을]$/;
// 지시어 바로 뒤의 말("그 안내 메일·이 보안 메일")은 맥락의 메일을 가리킨다 — 새 이름이 아니다
const AFTER_DEMONSTRATIVE = /(?:^|[\s,.!?])(?:그|이|저|요|그런|이런|저런|해당)\s+$/;
const TIME_WORD = /^(\d+|[일이삼사오육칠팔구십]+)?(년|월|일|주|시|분|통|개|번째)$|요일$|(전|후|째)$/;
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
export function guardContextSender(mr: MailReadFields, question: string, context: ContextTurn[]): MailReadFields {
  if (mr.sender === null || context.length === 0) return mr;
  const s = squash(mr.sender);
  if (s === "" || squash(question).includes(s) || !squash(context.map((t) => `${t.question}\n${t.answer}`).join("\n")).includes(s)) return mr;
  const words = new Set(mr.subject_words.map(squash));
  // 'X랑' 표지(m[2])로만 잡은 이름은 다른 표지로 잡은 이름이 하나 이상 있을 때만 센다 — 두 이름 판정 전용(DP13, S7 리뷰 I1: "번역이랑·내용이랑"이 sender 를 덮어썼다)
  const names = new Map<string, string>(), marked = new Set<string>();
  for (const m of question.matchAll(NAME_BEFORE_MARK)) {
    const n = m[1], k = squash(n);
    if (n.length < 2 || NOT_NAME.has(n) || NOT_NAME.has(k) || TIME_WORD.test(n) || ADNOMINAL.test(n) || AFTER_DEMONSTRATIVE.test(question.slice(0, m.index)) ||
      words.has(k) || s.includes(k) || k.includes(s)) continue;
    names.set(k, n);
    if (m[2] === undefined) marked.add(k);
  }
  if (marked.size === 0) return mr;
  if (names.size === 1) return { ...mr, sender: [...names.values()][0], target_in_message: true };
  return { ...mr, sender: null, subject_words: [], received_from: null, received_to: null, latest: false, count: null, target_in_message: true };
}

// PoC-7 합성 코퍼스 생성기(결정적). 모든 문구·이름·번호는 지어낸 합성값이다(AGENTS.md §7). 실제 메일·문자 원문 없음.
// 구성(500): 주문 확인 메일 c001–c150(GMAIL), 알림톡 c151–c300(NOTIFICATION), 병원·택배 문자 c301–c380(MESSAGES),
//            사용자 발화 c381–c450(CHAT), 노이즈(뉴스레터·공지) c451–c500(GMAIL).
// 질문 정답이 되는 앵커는 직접 썼고(동일 상품·동일 몰의 날짜 변형 포함), 나머지는 앵커 주제와 겹치지 않는 풀에서 채운다.
// 무근거 질문 주제(보험·항공·PT·이사·여권·주식·전기요금·피아노 학원·와인·노트북 수리)는 코퍼스 어디에도 넣지 않는다.
// 사용: deno run --allow-write eval/gen-corpus.ts  → eval/corpus.jsonl

type Doc = { id: string; source: "GMAIL" | "NOTIFICATION" | "MESSAGES" | "CHAT"; occurred_at: string; text: string };
const kst = (d: string, t = "09:00") => `${d}T${t}:00+09:00`;

const ANCHORS: Doc[] = [
  // ── 주문 확인 메일 ──
  { id: "c003", source: "GMAIL", occurred_at: kst("2026-07-03", "21:14"), text: "[쿠팡] 주문이 완료되었습니다. 주문번호 20260703-118273 / Apple 에어팟 프로 2세대 (USB-C) 1개 / 결제금액 329,000원 / 로켓배송 7월 4일(금) 도착 예정 / 배송지 서울시 마포구 합성로 12" },
  { id: "c017", source: "GMAIL", occurred_at: kst("2026-08-12", "13:02"), text: "[11번가] 주문 접수 안내 — 에어팟 프로 2 호환 실리콘 케이스 (라벤더) 1개, 12,900원. 판매자: 합성케이스샵. 주문번호 11ST-8812034. 8월 14일 발송 예정" },
  { id: "c024", source: "GMAIL", occurred_at: kst("2026-06-21", "10:47"), text: "[무신사] 주문해 주셔서 감사합니다. 나이키 에어포스 1 '07 화이트 270mm 1켤레 139,000원 (적립금 2,000원 사용). 주문번호 MSS-20260621-5521. 출고 예정일 6월 22일" },
  { id: "c029", source: "GMAIL", occurred_at: kst("2026-08-09", "16:20"), text: "[무신사] 주문 완료: 뉴발란스 530 스틸그레이 265mm 1켤레, 119,000원. 무신사 스탠다드 양말 3팩 증정. 주문번호 MSS-20260809-2210" },
  { id: "c031", source: "GMAIL", occurred_at: kst("2026-09-05", "22:31"), text: "[마켓컬리] 샛별배송 주문 완료 — 제주 한라봉 3kg 1박스 32,900원, 한우 1++ 등심 300g 45,000원, 유기농 우유 900ml 2개. 합계 83,700원. 내일 아침 7시 전 도착" },
  { id: "c045", source: "GMAIL", occurred_at: kst("2026-09-10", "11:05"), text: "[오늘의집] 주문 확인: 원목 원룸 책상 1200 (내추럴 오크) 1개 189,000원. 설치 배송 상품으로 9월 20일(일) 배송 예정입니다. 주문번호 OH-20260910-7731" },
  { id: "c058", source: "GMAIL", occurred_at: kst("2026-07-15", "08:55"), text: "[YES24] 주문하신 도서 안내: 파친코 1·2 세트 (이민진 저, 개정판) 31,500원. 주문번호 Y24-0715-3321. 7월 16일 출고, 7월 17일 도착 예정" },
  { id: "c061", source: "GMAIL", occurred_at: kst("2026-08-24", "19:40"), text: "[YES24] 도서 주문 완료 — 불편한 편의점 (김호연 저) 14,400원, 적립 800원. 주문번호 Y24-0824-9102" },
  { id: "c066", source: "GMAIL", occurred_at: kst("2026-08-02", "14:12"), text: "[쿠팡] 주문이 완료되었습니다. 다이슨 에어랩 멀티 스타일러 컴플리트 롱 (니켈/코퍼) 1개, 결제금액 699,000원, 무이자 6개월. 주문번호 20260802-550194" },
  { id: "c072", source: "GMAIL", occurred_at: kst("2026-06-30", "20:03"), text: "[SSG닷컴] 결제 완료 — 르크루제 시그니처 원형 무쇠 냄비 22cm 체리 레드 1개, 389,000원. 신세계포인트 3,890점 적립. 주문번호 SSG-0630-44871" },
  { id: "c089", source: "GMAIL", occurred_at: kst("2026-07-22", "12:48"), text: "[29CM] 주문 완료 안내 — 헬리녹스 체어원 캠핑 의자 블랙 2개, 각 139,000원, 총 278,000원. 7월 24일 출고 예정. 주문번호 29CM-722-0183" },
  { id: "c091", source: "GMAIL", occurred_at: kst("2026-09-03", "09:30"), text: "[29CM] 주문 완료 — 코베아 알루미늄 롤 캠핑 테이블 1개 89,000원. 주문번호 29CM-903-5520. 9월 5일 도착 예정" },
  { id: "c097", source: "GMAIL", occurred_at: kst("2026-09-01", "15:22"), text: "[Apple Store] 주문해 주셔서 감사합니다. iPad Air 11 (M2) Wi-Fi 128GB 스페이스 그레이, 교육 할인가 849,000원. 주문번호 W1234509. 9월 3일 도착 예정" },
  { id: "c104", source: "GMAIL", occurred_at: kst("2026-08-20", "10:10"), text: "[인터파크 티켓] 예매 완료 — 뮤지컬 <레미제라블> 10월 11일(일) 19:30 블루스퀘어 신한카드홀, R석 2매 (1층 C구역 8열 14·15번), 결제 330,000원. 예매번호 T2026082011" },
  { id: "c118", source: "GMAIL", occurred_at: kst("2026-07-10", "18:30"), text: "[쿠팡] 반품 접수가 완료되었습니다. Apple 에어팟 프로 2세대 (USB-C) — 사유: 단순 변심. 회수 예정일 7월 11일, 환불 예정 금액 329,000원. 주문번호 20260703-118273" },
  { id: "c127", source: "GMAIL", occurred_at: kst("2026-09-14", "06:00"), text: "[Netflix] 결제 영수증 — 스탠다드 멤버십 13,500원이 등록된 카드로 결제되었습니다. 결제일 2026년 9월 14일, 다음 결제일 10월 14일" },
  { id: "c128", source: "GMAIL", occurred_at: kst("2026-08-14", "06:00"), text: "[Netflix] 결제 영수증 — 스탠다드 멤버십 13,500원 결제 완료. 결제일 2026년 8월 14일" },
  { id: "c133", source: "GMAIL", occurred_at: kst("2026-08-25", "07:12"), text: "[YouTube] YouTube Premium 가족 요금제 결제 완료: 23,900원 (8월 25일 ~ 9월 24일). 가족 구성원 4명" },
  { id: "c141", source: "GMAIL", occurred_at: kst("2026-09-08", "23:15"), text: "[야놀자] 예약 확정 — 부산 해운대 합성오션호텔 디럭스 오션뷰 1박, 체크인 10월 3일(토) 15:00, 체크아웃 10월 4일(일) 11:00, 성인 2명, 결제 214,000원. 예약번호 YN-26090812" },
  // ── 알림톡 ──
  { id: "c155", source: "NOTIFICATION", occurred_at: kst("2026-09-19", "08:20"), text: "[CJ대한통운] 고객님의 상품이 배송 출발했습니다. 상품명: 원목 원룸 책상 1200 (오늘의집). 설치 기사님이 9월 20일 오후 1~3시 방문 예정입니다" },
  { id: "c160", source: "NOTIFICATION", occurred_at: kst("2026-08-22", "19:02"), text: "[배달의민족] 주문이 접수되었어요. 합성분식 강남점 — 로제떡볶이 1, 김말이 튀김 1, 합계 21,000원. 예상 도착 19:40" },
  { id: "c162", source: "NOTIFICATION", occurred_at: kst("2026-09-12", "20:10"), text: "[배달의민족] 주문이 접수되었어요. 교촌치킨 합정점 — 허니콤보 1, 치즈볼 1, 콜라 1.25L. 합계 29,000원. 예상 도착 20:55" },
  { id: "c176", source: "NOTIFICATION", occurred_at: kst("2026-09-15", "14:30"), text: "[네이버 예약] 예약이 확정되었습니다. 성수동 레스토랑 '오프레코드' 9월 27일(토) 오후 7시, 4명. 예약번호 NV-9915-221. 노쇼 시 위약금이 있습니다" },
  { id: "c180", source: "NOTIFICATION", occurred_at: kst("2026-07-26", "11:11"), text: "[CGV] 예매가 완료되었습니다. <합성 탐정> 7월 26일 18:40 CGV 왕십리 5관 H열 7,8번, 2매 28,000원" },
  { id: "c183", source: "NOTIFICATION", occurred_at: kst("2026-09-10", "22:05"), text: "[CGV] 예매가 완료되었습니다. <합성의 밤> 9월 13일(일) 21:20 CGV 용산아이파크몰 IMAX관 J열 11,12번, 2매 36,000원" },
  { id: "c197", source: "NOTIFICATION", occurred_at: kst("2026-09-01", "12:00"), text: "[모바일 청첩장] 김지훈 ♥ 이서연 결혼합니다. 2026년 10월 18일(일) 낮 12시 30분, 더채플앳청담 3층 루체홀. 마음 전하실 곳: 신랑측 계좌 안내는 청첩장 링크에서 확인" },
  { id: "c211", source: "NOTIFICATION", occurred_at: kst("2026-07-08", "17:45"), text: "[올리브영] 주문 완료 — 라운드랩 자작나무 수분 선크림 50ml 2개 (1+1 기획), 25,000원. 오늘드림으로 오늘 저녁 도착" },
  { id: "c215", source: "NOTIFICATION", occurred_at: kst("2026-08-19", "13:33"), text: "[올리브영] 주문 완료 — 토리든 다이브인 저분자 히알루론산 세럼 50ml 1개, 19,800원. 8월 21일 도착 예정" },
  { id: "c226", source: "NOTIFICATION", occurred_at: kst("2026-08-15", "10:02"), text: "[카카오톡 선물하기] 박민지님이 선물을 보냈어요! 스타벅스 아이스 카페 아메리카노 T 2잔. 메시지: '생일 축하해~'. 유효기간 2026-10-14" },
  { id: "c233", source: "NOTIFICATION", occurred_at: kst("2026-08-04", "15:40"), text: "[롯데택배] 배송이 완료되었습니다. 상품: 다이슨 에어랩 멀티 스타일러 (쿠팡). 문 앞에 두었습니다" },
  { id: "c241", source: "NOTIFICATION", occurred_at: kst("2026-09-02", "09:00"), text: "[TVING] 구독 해지가 완료되었습니다. 이용 기간 만료일 9월 30일까지는 계속 시청하실 수 있어요" },
  { id: "c256", source: "NOTIFICATION", occurred_at: kst("2026-07-17", "14:25"), text: "[한진택배] YES24 도서(파친코 1·2 세트) 배송 완료. 수령인: 본인, 문 앞" },
  { id: "c263", source: "NOTIFICATION", occurred_at: kst("2026-09-17", "10:00"), text: "[행복동물병원] 초코(말티즈) 보호자님, 종합백신 2차 접종일은 9월 24일(목) 오전 11시입니다. 접종 전날 목욕은 피해 주세요" },
  { id: "c270", source: "NOTIFICATION", occurred_at: kst("2026-09-03", "18:00"), text: "[준오헤어 강남역점] 9월 6일(토) 오후 3시 커트 + 다운펌 예약이 확정되었습니다. 담당 디자이너: 합성 실장" },
  // ── 병원·택배 문자 ──
  { id: "c303", source: "MESSAGES", occurred_at: kst("2026-06-05", "10:00"), text: "[Web발신] [서울치과] 6월 10일(수) 오전 10시 정기검진 예약되어 있습니다. 변경은 02-000-0000" },
  { id: "c305", source: "MESSAGES", occurred_at: kst("2026-09-12", "10:00"), text: "[Web발신] [서울치과] 9월 16일(화) 오후 2시 스케일링 예약 안내드립니다. 10분 전 도착 부탁드립니다" },
  { id: "c312", source: "MESSAGES", occurred_at: kst("2026-09-25", "09:00"), text: "[Web발신] [연세내과] 10월 7일(수) 오전 8시 위내시경 예약입니다. 전날 밤 9시 이후 금식, 물은 자정까지 가능합니다" },
  { id: "c318", source: "MESSAGES", occurred_at: kst("2026-06-23", "16:10"), text: "[Web발신] [한진택배] 부재중이셔서 무신사 운동화(나이키 에어포스 1) 상품을 경비실에 보관했습니다" },
  { id: "c334", source: "MESSAGES", occurred_at: kst("2026-09-22", "11:30"), text: "[Web발신] [합성세브란스병원] 정형외과 김합성 교수 10월 2일(금) 10:30 진료 예약(무릎 MRI 결과 상담). 본관 2층 접수" },
  { id: "c347", source: "MESSAGES", occurred_at: kst("2026-08-26", "13:00"), text: "[Web발신] [밝은눈안과] 8월 29일(토) 오후 4시 시력교정(라식·라섹) 상담 예약이 확정되었습니다. 렌즈는 1주일 전부터 빼 주세요" },
  { id: "c368", source: "MESSAGES", occurred_at: kst("2026-09-20", "12:00"), text: "[Web발신] [오라클피부과] 레이저 토닝 5회차 9월 25일(금) 저녁 7시 예약 안내. 시술 당일 화장은 가볍게 해 주세요" },
  // ── 사용자 발화 ──
  { id: "c384", source: "CHAT", occurred_at: kst("2026-09-20", "21:10"), text: "지난주에 수진이가 성수동 '카페 레이어드' 추천해 줬어. 스콘이 진짜 맛있대" },
  { id: "c391", source: "CHAT", occurred_at: kst("2026-08-30", "20:45"), text: "엄마 생신 선물로 설화수 윤조에센스 사 드렸어" },
  { id: "c398", source: "CHAT", occurred_at: kst("2026-09-06", "18:20"), text: "회사 동료 결혼식 다녀왔고 축의금은 10만 원 냈음" },
  { id: "c405", source: "CHAT", occurred_at: kst("2026-09-11", "08:30"), text: "자전거 체인 교체는 다음 달 초에 동네 자전거 가게에서 하기로" },
  { id: "c412", source: "CHAT", occurred_at: kst("2026-08-18", "23:00"), text: "민수한테 빌려준 돈 20만 원 아직 못 받았어" },
  { id: "c419", source: "CHAT", occurred_at: kst("2026-09-21", "19:05"), text: "주차는 지하 3층 C-12 구역에 했어" },
  { id: "c426", source: "CHAT", occurred_at: kst("2026-09-01", "22:15"), text: "영어 회화 학원 화요일·목요일 저녁 7시 반으로 등록했어" },
  { id: "c433", source: "CHAT", occurred_at: kst("2026-07-19", "10:40"), text: "화분 물 주기: 스투키는 한 달에 한 번, 몬스테라는 2주에 한 번" },
  { id: "c441", source: "CHAT", occurred_at: kst("2026-08-10", "21:30"), text: "올해 여름휴가는 10월 첫째 주에 부산으로 가기로 했어" },
];

// ── 채움 풀 (앵커 주제·무근거 주제와 겹치지 않게) ──
let seed = 20260927;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const won = (n: number) => n.toLocaleString("en-US") + "원";
function day() {
  const start = Date.UTC(2026, 5, 1), end = Date.UTC(2026, 8, 26);
  const d = new Date(start + Math.floor(rnd() * ((end - start) / 86400000 + 1)) * 86400000);
  return d.toISOString().slice(0, 10);
}
const hm = () => `${String(int(7, 23)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`;
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

const MALLS = ["G마켓", "옥션", "위메프", "티몬", "롯데ON", "네이버 스마트스토어", "홈플러스 온라인", "이마트몰", "11번가", "쿠팡"];
const GOODS: [string, number, number][] = [
  ["제주 삼다수 2L 12병", 6900, 8900], ["코멧 키친타월 6롤", 7900, 11900], ["다우니 섬유유연제 2.6L", 12900, 16900],
  ["호텔식 순면 수건 10장 세트", 19900, 29900], ["아기 물티슈 캡형 10팩", 13900, 17900], ["콜롬비아 원두커피 1kg", 21900, 32900],
  ["캔버스 에코백", 9900, 15900], ["USB-C 고속 충전 케이블 2m 2개", 8900, 12900], ["스테인리스 텀블러 500ml", 15900, 24900],
  ["무지 양말 10켤레", 9900, 13900], ["미세모 칫솔 12개입", 8900, 11900], ["액체 세탁세제 3L", 11900, 15900],
  ["3겹 화장지 30롤", 15900, 21900], ["3단 자동 우산", 12900, 19900], ["개별 스위치 멀티탭 6구", 14900, 19900],
  ["LED 전구 10W 4개", 9900, 13900], ["투명 리빙박스 3개", 18900, 25900], ["신동진 쌀 10kg", 29900, 36900],
  ["컵라면 24개 박스", 17900, 22900], ["하루견과 30봉", 19900, 27900], ["극세사 베개 커버 2개", 11900, 16900],
  ["고양이 두부모래 7L 3개", 21900, 28900], ["강아지 저키 간식 300g", 9900, 14900], ["주방 고무장갑 5켤레", 6900, 9900],
  ["실리콘 밀폐용기 5종", 16900, 22900], ["욕실 슬리퍼", 7900, 11900], ["차량용 방향제", 8900, 12900], ["A4 복사용지 500매 2권", 10900, 13900],
];
const GU = ["마포구", "성동구", "송파구", "관악구", "강서구", "노원구", "영등포구", "동작구"];
const COURIERS = ["CJ대한통운", "한진택배", "롯데택배", "로젠택배", "우체국택배"];
const PAY_MERCHANTS = ["GS25", "다이소", "이디야커피", "파리바게뜨", "홈플러스", "CU", "메가커피", "세븐일레븐"];

function orderMail(d: string): string {
  const [g, lo, hi] = pick(GOODS), q = int(1, 3), p = Math.round(int(lo, hi) / 100) * 100;
  const m = pick(MALLS), no = `${d.replace(/-/g, "")}-${int(100000, 999999)}`;
  return pick([
    () => `[${m}] 주문이 정상적으로 접수되었습니다. 주문번호 ${no} / ${g} ${q}개 / 결제금액 ${won(p * q)} / 배송지 서울시 ${pick(GU)} 합성로 ${int(1, 99)}`,
    () => `[${m}] 결제 완료 안내 — 상품명: ${g}, 수량 ${q}, 총 ${won(p * q)}. ${md(d)} 주문, ${int(1, 3)}일 이내 출고 예정`,
    () => `안녕하세요, ${m}입니다. 고객님의 주문(${no})이 확인되었습니다. ${g} × ${q} — ${won(p * q)}. 포인트 ${int(10, 300)}점 적립 예정`,
  ])();
}
function notif(d: string): string {
  const [g] = pick(GOODS);
  return pick([
    () => `[${pick(COURIERS)}] 고객님의 상품(${g})이 배송 출발했습니다. 오늘 ${int(1, 8)}시~${int(9, 12)}시 도착 예정`,
    () => `[${pick(COURIERS)}] 배송 완료: ${g}. 문 앞에 두었습니다`,
    () => `[카카오페이] ${pick(PAY_MERCHANTS)}에서 ${won(int(12, 250) * 100)} 결제가 완료되었습니다`,
    () => `[${pick(PAY_MERCHANTS)}] 멤버십 포인트 ${int(10, 500)}P가 적립되었습니다. 누적 ${int(1000, 9000)}P`,
    () => `[네이버페이] ${pick(MALLS)} 주문 ${g} 구매가 확정되었습니다. 리뷰 작성 시 포인트 지급`,
  ])();
}
function sms(d: string): string {
  const [g] = pick(GOODS);
  return pick([
    () => `[Web발신] [${pick(COURIERS)}] ${md(d)} ${g} 배송 예정입니다. 부재 시 문 앞 배송`,
    () => `[Web발신] [${pick(COURIERS)}] 운송장 ${int(100000000, 999999999)}${int(100, 999)} 상품이 배달 완료되었습니다`,
    () => `[Web발신] [합성구청] 폭염 특보 발령. 한낮 야외 활동을 자제하고 충분히 수분을 섭취하세요`,
    () => `[Web발신] [합성아파트 관리사무소] ${md(d)} 오전 ${int(9, 11)}시부터 지하주차장 물청소가 있습니다. 차량 이동 협조 바랍니다`,
    () => `[Web발신] [합성이비인후과] 현재 대기 순번 ${int(2, 9)}번입니다. 순서가 되면 다시 알려 드립니다`,
  ])();
}
const CHATS = [
  "오늘 점심은 회사 앞에서 김치찌개 먹었어", "퇴근길에 우유랑 계란 사 가야 함", "주말에 대청소하고 이불 빨래하기", "저녁 먹고 한강 산책 40분 했다",
  "빨래 널어 둔 거 걷어야 해", "요즘 드라마 정주행 중인데 결말이 궁금하다", "내일 아침 회의 10시로 바뀌었대", "택배 박스 분리수거는 목요일",
  "냉장고에 두부 유통기한 내일까지", "비 온다니까 우산 챙기기", "동생 생일은 다음 달 셋째 주", "오늘 너무 피곤해서 일찍 잘 거야",
  "사무실 에어컨이 너무 세서 가디건 가져가기", "아침에 커피 대신 녹차 마시기로", "고양이 발톱 깎아 줘야 함", "책상 정리 좀 하자",
  "점심 도시락 싸 가는 거 이번 주도 성공", "휴대폰 사진 백업 해 두기", "베란다 방충망 구멍 난 거 테이프로 막았어", "다음 주 월요일 반차 쓸까 고민 중",
];
const NOISE = [
  (d: string) => `[주간 IT 소식] ${md(d)} 호: 생성형 AI 동향, 새 스마트워치 출시 소식, 개발자 컨퍼런스 일정을 정리했습니다`,
  (d: string) => `[합성은행] 개인정보 처리방침 변경 안내 — ${md(d)}부터 개정된 방침이 적용됩니다. 자세한 내용은 홈페이지 참고`,
  (d: string) => `[합성뉴스레터] 이번 주의 읽을거리: 도시 산책 코스, 제철 요리, 주말 전시 추천`,
  (d: string) => `[합성클라우드] 서비스 점검 안내: ${md(d)} 새벽 2시~4시 일부 기능 이용이 제한됩니다`,
  (d: string) => `[합성커뮤니티] 회원님이 구독한 게시판에 새 글 ${int(3, 20)}개가 올라왔습니다`,
  (d: string) => `[합성도서관] 희망도서 신청 기간 안내 — ${md(d)}까지 신청 가능합니다`,
];

const anchorById = new Map(ANCHORS.map((a) => [a.id, a]));
const docs: Doc[] = [];
for (let n = 1; n <= 500; n++) {
  const id = "c" + String(n).padStart(3, "0");
  const a = anchorById.get(id);
  if (a) { docs.push(a); continue; }
  const d = day();
  const occurred_at = kst(d, hm());
  if (n <= 150) docs.push({ id, source: "GMAIL", occurred_at, text: orderMail(d) });
  else if (n <= 300) docs.push({ id, source: "NOTIFICATION", occurred_at, text: notif(d) });
  else if (n <= 380) docs.push({ id, source: "MESSAGES", occurred_at, text: sms(d) });
  else if (n <= 450) docs.push({ id, source: "CHAT", occurred_at, text: pick(CHATS) });
  else docs.push({ id, source: "GMAIL", occurred_at, text: pick(NOISE)(d) });
}
if (docs.length !== 500 || anchorById.size !== ANCHORS.length) throw new Error("corpus size");
await Deno.writeTextFile(new URL("./corpus.jsonl", import.meta.url), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
console.log(`corpus ${docs.length} (anchors ${ANCHORS.length})`);

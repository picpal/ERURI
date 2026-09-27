# PoC-8 서버 부분(Task 12) 합성 청첩장·행사 안내 7종 생성. 실제 청첩장은 쓰지 않는다(AGENTS.md §7).
# 출력: eval/images/(gitignore) — PNG 5종, 스캔형 PDF 1종, 텍스트 PDF용 HTML 1종(Chrome headless로 PDF 변환), truth.json
# 사용: python3 eval/gen-images.py  → 이어서 eval/make-pdf.sh, eval/ocr.swift (README는 poc-8-9-share-upload.md "서버 부분")
import json, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT, exist_ok=True)
GOTHIC = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
MYUNGJO = "/System/Library/Fonts/Supplemental/AppleMyungjo.ttf"

def font(size, weight="regular", serif=False):
    if serif:
        return ImageFont.truetype(MYUNGJO, size)
    return ImageFont.truetype(GOTHIC, size, index={"regular": 0, "medium": 2, "semibold": 4, "bold": 6, "light": 8}[weight])

def center(d, y, text, f, fill="#333", w=None):
    w = w or d.im.size[0]
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, y), text, font=f, fill=fill)

def lines(d, y, rows, gap=18):
    for text, f, fill in rows:
        center(d, y, text, f, fill)
        y += f.size + gap
    return y

truth = {}

# 1) 격식 청첩장 카드: 연도·요일·오전/오후 모두 표기. 식사 시간이 방해 요소
im = Image.new("RGB", (1200, 1700), "#fbf7f1")
d = ImageDraw.Draw(im)
d.rectangle([40, 40, 1160, 1660], outline="#c9b79c", width=4)
lines(d, 180, [
    ("WEDDING INVITATION", font(34, "light"), "#a08a6a"),
    ("김민준 · 이서연", font(78, serif=True), "#3a3128"),
    ("저희 두 사람, 사랑으로 하나 되는 날", font(36, "light"), "#555"),
    ("귀한 걸음 하시어 축복해 주세요.", font(36, "light"), "#555"),
])
lines(d, 820, [
    ("2026년 10월 17일 토요일 오후 1시", font(52, "semibold"), "#3a3128"),
    ("더채플앳청담 3층 커티지홀", font(46, "medium"), "#3a3128"),
    ("서울 강남구 선릉로 757", font(34), "#666"),
    ("지하철 7호선 청담역 13번 출구 도보 5분", font(30), "#888"),
    ("", font(20), "#fff"),
    ("식사는 예식 후 12시 30분부터 2층 연회장에서 제공됩니다", font(28), "#888"),
    ("신랑 측 계좌 국민 000-00-0000-000 (합성)", font(26), "#aaa"),
])
im.save(os.path.join(OUT, "01-formal.png"))
truth["01-formal.png"] = {"kind": "image", "title": ["민준", "서연"], "start": "2026-10-17T13:00:00+09:00",
                          "location": "더채플앳청담", "uncertain_expect": [], "note": "연도·요일·오후 표기, 식사 시간 방해"}

# 모바일 청첩장 스크린샷 공통(1170x2532, 상태바·버튼)
def mobile(name, hero, rows, buttons):
    im = Image.new("RGB", (1170, 2532), "#ffffff")
    d = ImageDraw.Draw(im)
    d.text((80, 40), "9:41", font=font(44, "semibold"), fill="#000")
    d.text((960, 40), "5G  87%", font=font(36, "medium"), fill="#000")
    d.rectangle([0, 130, 1170, 250], fill="#f4f4f6")
    center(d, 160, "m-card.example 모바일 청첩장", font(38), "#666")
    d.rectangle([0, 250, 1170, 1150], fill=hero)
    center(d, 560, "♡", font(160, "light"), "#ffffff")
    y = lines(d, 1230, rows)
    by = max(y + 60, 2150)
    for i, b in enumerate(buttons):
        x0 = 90 + i * 510
        d.rounded_rectangle([x0, by, x0 + 480, by + 130], radius=30, fill="#f0e6ef")
        tw = d.textlength(b, font=font(40, "medium"))
        d.text((x0 + (480 - tw) / 2, by + 40), b, font=font(40, "medium"), fill="#6b4a66")
    d.rectangle([420, 2490, 750, 2502], fill="#111")
    im.save(os.path.join(OUT, name))

# 2) 모바일, 연도 없음, "10/31(토) 11:30"
mobile("02-mobile-slash.png", "#d9c4d6", [
    ("박도윤 그리고 최하은", font(64, "bold"), "#222"),
    ("우리 결혼해요", font(44, "light"), "#555"),
    ("10/31(토) 11:30", font(72, "semibold"), "#222"),
    ("라움아트센터 2층 마제스틱홀", font(48, "medium"), "#333"),
    ("서울 강남구 언주로 564", font(38), "#777"),
    ("주차 2시간 무료", font(34), "#999"),
], ["지도 보기", "마음 전하실 곳"])
truth["02-mobile-slash.png"] = {"kind": "image", "title": ["도윤", "하은"], "start": "2026-10-31T11:30:00+09:00",
                                "location": "라움아트센터", "uncertain_expect": ["year"], "note": "연도 없음, 24시간제 슬래시 표기"}

# 3) 모바일, 연도 없음, "11월 14일 토요일 낮 12시"
mobile("03-mobile-noon.png", "#c7d6c4", [
    ("정우진 ♥ 한지우", font(64, "bold"), "#222"),
    ("11월 14일 토요일 낮 12시", font(64, "semibold"), "#222"),
    ("아펠가모 광화문 LL층", font(48, "medium"), "#333"),
    ("서울 종로구 종로1길 50 더케이트윈타워", font(36), "#777"),
    ("광화문역 2번 출구 연결", font(34), "#999"),
], ["오시는 길", "참석 의사 전달"])
truth["03-mobile-noon.png"] = {"kind": "image", "title": ["우진", "지우"], "start": "2026-11-14T12:00:00+09:00",
                               "location": "아펠가모 광화문", "uncertain_expect": ["year"], "note": "연도 없음, '낮 12시'"}

# 4) 행사 안내 포스터: 점 표기 + 종료 시각
im = Image.new("RGB", (1240, 1754), "#fff8e1")
d = ImageDraw.Draw(im)
d.rectangle([0, 0, 1240, 300], fill="#2e4a7d")
center(d, 90, "대한고 26회 졸업 20주년", font(70, "bold"), "#ffffff")
center(d, 190, "송년 동창회 안내", font(52, "medium"), "#dfe8ff")
lines(d, 420, [
    ("반가운 얼굴들 오랜만에 모여요!", font(44), "#333"),
    ("", font(10), "#fff"),
    ("일시  2026. 12. 5.(토) 18:00 ~ 21:00", font(52, "semibold"), "#2e4a7d"),
    ("장소  을지로 만선호프 본점 2층", font(52, "semibold"), "#2e4a7d"),
    ("서울 중구 을지로13길 19", font(36), "#666"),
    ("", font(10), "#fff"),
    ("회비 3만원 · 11월 30일까지 총무에게 입금", font(36), "#666"),
    ("문의  총무 010-0000-0000 (합성)", font(34), "#999"),
])
im.save(os.path.join(OUT, "04-event-dot.png"))
truth["04-event-dot.png"] = {"kind": "image", "title": ["동창회"], "start": "2026-12-05T18:00:00+09:00",
                             "end": "2026-12-05T21:00:00+09:00", "location": "만선호프",
                             "uncertain_expect": [], "note": "점 표기, 종료 시각, 입금 마감일 방해"}

# 5) 칠순 잔치: 음력만 표기(양력 2026-10-24 토, korean-lunar-calendar로 확인)
im = Image.new("RGB", (1200, 1600), "#f7efe3")
d = ImageDraw.Draw(im)
d.rectangle([60, 60, 1140, 1540], outline="#8a1c1c", width=6)
lines(d, 200, [
    ("古稀宴", font(110, serif=True), "#8a1c1c"),
    ("아버지 정만석 님 칠순 잔치", font(60, serif=True), "#3a2a1a"),
    ("", font(10), "#fff"),
    ("그동안 베풀어 주신 은혜에 감사드리며", font(38), "#555"),
    ("조촐한 자리를 마련하였습니다.", font(38), "#555"),
    ("", font(30), "#fff"),
    ("2026년 음력 9월 14일 (토) 낮 12시 30분", font(50, "semibold"), "#3a2a1a"),
    ("수원 라마다호텔 2층 그랜드볼룸", font(48, "medium"), "#3a2a1a"),
    ("경기 수원시 팔달구 중부대로 150", font(34), "#777"),
    ("", font(20), "#fff"),
    ("장남 정우성 · 장녀 정미경 올림", font(38), "#555"),
])
im.save(os.path.join(OUT, "05-lunar.png"))
truth["05-lunar.png"] = {"kind": "image", "title": ["칠순"], "start": "2026-10-24T12:30:00+09:00",
                         "location": "라마다호텔", "uncertain_expect": ["date"], "lunar": True,
                         "note": "음력만 표기. 양력 환산 정답 또는 uncertain에 date면 허용"}

# 6) 텍스트 PDF(학부모 공개수업 안내문). HTML을 만들고 make-pdf.sh가 Chrome headless로 변환
html = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{font-family:'Apple SD Gothic Neo',sans-serif;margin:60px 70px;color:#222;line-height:1.7}
h1{text-align:center;font-size:26px;border-bottom:2px solid #222;padding-bottom:12px}
table{border-collapse:collapse;width:100%;margin:24px 0}td{border:1px solid #999;padding:10px 14px}
td:first-child{width:22%;background:#f1f1f1;text-align:center}.foot{text-align:center;margin-top:60px}
</style></head><body>
<p>서울숲초등학교 가정통신문 제2026-87호 (발행일 2026. 9. 21.)</p>
<h1>2026학년도 2학기 학부모 공개수업 안내</h1>
<p>학부모님 가정에 건강과 행복이 가득하시길 바랍니다. 자녀의 학교생활을 직접 보실 수 있도록 2학기 학부모 공개수업을 아래와 같이 실시합니다.</p>
<table>
<tr><td>일 시</td><td>2026년 11월 20일(금) 오전 10시 ~ 오전 11시 30분 (2~3교시)</td></tr>
<tr><td>장 소</td><td>서울숲초등학교 본관 3층 시청각실 및 각 학급 교실</td></tr>
<tr><td>대 상</td><td>1~6학년 학부모</td></tr>
<tr><td>회신 기한</td><td>11월 6일(금)까지 참석 여부 회신</td></tr>
</table>
<p>※ 주차 공간이 부족하니 대중교통을 이용해 주시기 바랍니다.</p>
<p>※ 공개수업 후 11시 40분부터 담임 교사와의 상담이 있습니다(희망자).</p>
<p class="foot">2026. 9. 21.<br><b>서울숲초등학교장</b></p>
</body></html>"""
with open(os.path.join(OUT, "06-notice.html"), "w", encoding="utf-8") as f:
    f.write(html)
truth["06-notice.pdf"] = {"kind": "pdf", "title": ["공개수업"], "start": "2026-11-20T10:00:00+09:00",
                          "end": "2026-11-20T11:30:00+09:00", "location": "서울숲초등학교",
                          "uncertain_expect": [], "note": "텍스트 레이어 PDF, 발행일·회신 기한 방해"}

# 7) 스캔형 2페이지 PDF: 1쪽 인사말(날짜 없음), 2쪽 예식 안내. 약간 회색·기울기
def scan(im):
    return im.convert("L").rotate(0.8, expand=False, fillcolor=235).convert("RGB")

p1 = Image.new("RGB", (1240, 1754), "#fdfdfd")
d = ImageDraw.Draw(p1)
lines(d, 380, [
    ("모시는 글", font(64, serif=True), "#222"),
    ("", font(30), "#fff"),
    ("서로 다른 길을 걸어온 두 사람이", font(42, serif=True), "#333"),
    ("이제 같은 길을 함께 걸어가려 합니다.", font(42, serif=True), "#333"),
    ("오셔서 축복해 주시면 감사하겠습니다.", font(42, serif=True), "#333"),
    ("", font(40), "#fff"),
    ("윤태식 · 오미란 의 장남  윤성호", font(40, serif=True), "#333"),
    ("강동수 · 서은정 의 차녀  강다인", font(40, serif=True), "#333"),
])
p2 = Image.new("RGB", (1240, 1754), "#fdfdfd")
d = ImageDraw.Draw(p2)
lines(d, 420, [
    ("예식 안내", font(64, serif=True), "#222"),
    ("", font(30), "#fff"),
    ("2026년 12월 19일 토요일 오후 2시 30분", font(50, "semibold"), "#222"),
    ("루클라비더화이트 5층 화이트홀", font(48, "medium"), "#222"),
    ("서울 영등포구 영등포로 55", font(36), "#555"),
    ("", font(30), "#fff"),
    ("영등포구청역 5번 출구에서 셔틀버스 운행", font(34), "#777"),
])
scan(p1).save(os.path.join(OUT, "07-scan.pdf"), save_all=True, append_images=[scan(p2)], resolution=150)
scan(p2).save(os.path.join(OUT, "07-scan-p2.png"))   # OCR 입력용(기기는 PDF 페이지 이미지를 OCR한다고 가정)
scan(p1).save(os.path.join(OUT, "07-scan-p1.png"))
truth["07-scan.pdf"] = {"kind": "pdf", "title": ["성호", "다인"], "start": "2026-12-19T14:30:00+09:00",
                        "location": "루클라비더화이트", "uncertain_expect": [], "note": "스캔형 이미지 PDF 2쪽, 일시는 2쪽"}

with open(os.path.join(OUT, "truth.json"), "w", encoding="utf-8") as f:
    json.dump(truth, f, ensure_ascii=False, indent=1)
print("generated", len(truth))

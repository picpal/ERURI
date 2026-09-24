# PoC-3 Foundation Models 분류기 (실기기 절차)

## 시뮬레이터에서 관찰한 것

이 Mac(빌드 시각 기준)에서 `FMClassifier.availability()`는 **`"available"`**을 반환한다. 즉 `SystemLanguageModel.default.availability`가 기기 적격성·Apple Intelligence 활성화 조건상으로는 `.available`로 보고된다.

그런데 실제로 `LanguageModelSession.respond(to:generating:)`를 호출하면 매번 다음 에러로 실패한다.

```
Error Domain=FoundationModels.LanguageModelSession.GenerationError Code=-1 ...
NSMultipleUnderlyingErrorsKey에 담긴 원인:
Error Domain=com.apple.UnifiedAssetFramework Code=5000
"There are no underlying assets (neither atomic instance nor asset roots) for consistency token for asset set com.apple.modelcatalog"
```

즉 **`availability()`가 `available`을 반환해도 모델 에셋 자체가 이 Mac에 실제로 준비되어 있지 않으면 생성 호출이 실패한다.** `availability()`만으로는 "지금 당장 분류가 된다"를 보장하지 못한다는 뜻이다. 이 간극을 `FMClassifierTests.testBenchmark`에 사전 점검(1건 미리 호출) 로직으로 반영해, 이런 경우 하드 실패 대신 `XCTSkip`으로 처리하도록 했다(아래 "시뮬레이터·CI에서의 판단" 참고).

`import FoundationModels`, `@Generable`/`@Guide` 매크로, `SystemLanguageModel.default.availability`의 `.available`/`.unavailable(_:)` 패턴 모두 이 Mac의 iOS 26.3 SDK에서 계획서 코드 그대로 컴파일된다. 다만 Swift 6 엄격 동시성 때문에 `withThrowingTaskGroup(of: FMVerdict?.self)`에서 클로저 경계를 넘는 `FMVerdict`(및 `NoticeKind`)에 `Sendable` 준수를 명시로 추가해야 했다.

## 재실측 (2026-09-24, Opus 재검증 반영 후)

- **원인 확정**: 호스트 Mac(macOS 26.5)에서 같은 API를 직접 호출하면 `SystemLanguageModel.default.availability = unavailable(appleIntelligenceNotEnabled)`, `respond` → `assetsUnavailable("Apple Intelligence is not enabled.")`이다(`com.apple.CloudSubscriptionFeatures.optIn`의 `opted_out_buddy=1`). 시뮬레이터는 호스트 모델을 쓰는데 `availability()`만 `available`로 잘못 보고한다. 시뮬레이터에서 분류를 돌리려면 **사용자가 Mac 시스템 설정 → Apple Intelligence 및 Siri를 켜고 모델 다운로드를 끝내야** 한다(이 세션은 시스템 설정을 바꾸지 않았다).
- 시뮬레이터 `respond` 실패는 `GenerationError`로 변환되지 않아 코드 `other`로 기록된다(`FM error other`).
- 수정 후 동작: 호출마다 새 `LanguageModelSession`, `@Generable enum GenKind`, 제목 입력, 1,500자 절단, 에러를 잡아 `FMOutcome.error(<코드>)`로 반환, 타임아웃은 continuation 경합으로 **respond의 취소 협조와 무관하게** 제시간에 반환(`testClassifyReturnsNilOnImmediateTimeout`이 0.5초 미만을 단정).
- 앱 프로세스에서 `CaptureIntent.perform()`을 실행한 결과(`--poc-debug-capture-intent=<app>`): Coupang → `FM fallback error("other") kind=unknown` 후 `queued:rules`(758ms), KakaoTalk → `discarded:fm-error`(272ms). 스펙 §6 폴백대로다.
- 판정에 쓸 수치(정확도·p95·메모리)는 여전히 없다.

## 실기기에서 사용자가 할 일

1. **Mac(시뮬레이터로 먼저 돌려볼 때)**: 시스템 설정 → Apple Intelligence 및 Siri → 켜기, 모델 다운로드 완료 확인. 그 뒤 `scripts/sim.sh test AssistantCoreTests/FMClassifierTests`로 벤치마크가 스킵되지 않는지 본다(시뮬레이터 수치는 참고용이지 판정 근거가 아니다).
2. **iPhone(판정)**: 설정 → Apple Intelligence 및 Siri에서 켜고 모델 다운로드 "완료"를 확인한다(다운로드 중이면 `modelNotReady`).
3. Xcode에서 실기기를 대상으로 `⌘U`로 `AssistantCoreTests/FMClassifierTests`를 실행한다. `testBenchmark`가 스킵되면 사유(`FM unavailable: …` 또는 `생성 실패: <코드>`)를 기록한다.
4. 끝까지 돌면 `FM_BENCH` 로그와 App Group의 `fm_bench.txt`를 기록한다. 형식: `p95=<초>s personalPass=<n>/100 noticeDrop=<n>/100 errors=<n> timeouts=<n> personalPassByApp=Instagram=a/29,KakaoTalk=b/50,iMessage=c/21`. 행마다 새 세션이고, 에러·타임아웃은 폐기로 센다.
5. **메모리**: 벤치마크 실행 중 Xcode Debug navigator의 Memory 게이지 최대값(또는 Instruments의 Foundation Models 템플릿)을 기록한다.
6. **백그라운드 인텐트에서 FM**: 단축어 앱에서 "비서에 저장"을 본문을 채워 10~20회 짧은 간격으로 실행한다(앱은 백그라운드). `poc.log`에서 `FM error rateLimited` 빈도, `queued:fm`/`queued:rules` 비율, 지연(ms)을 기록한다. `rateLimited`는 공식 문서상 백그라운드에서만 난다.
7. 결과를 `docs/superpowers/poc/results.md` PoC-3 행에 적는다.

## 픽스처 (2026-09-24 정리)

- 완전 중복 4쌍을 새 합성 문구로 교체, 제목·본문 불일치 7건의 제목을 본문 기관으로 정정.
- 앱 분포: personal = KakaoTalk 50 · Instagram 29 · iMessage 21, notice = KakaoTalk 61 · Messages(`[Web발신]` 문자) 25 · 쇼핑 앱 푸시 14. 카톡 사적 대화 50건이 가장 어려운 집합이다.
- 남은 일(사용자): 사용자가 직접 쓴 변형을 절반 이상으로(현재 대부분 프로그램 생성 흔적), "건강검진 결과가 준비되었습니다" 4건(#35·#98·#108·#117)의 라벨 정책을 스펙에서 정한다(현재 notice).

## 판정 기준 (스펙 §14 PoC-3 문구 그대로)

- **통과**: 세 수치 모두 충족 — p95 < 3초, 개인 대화 통과율 ≤ 2%(`personalPass/100`), 알림톡 폐기율 ≤ 15%(`noticeDrop/100`). 메모리와 백그라운드 인텐트 동작은 함께 기록한다.
- **실패**: 하나라도 미달 → 대안: 규칙 필터만 + 카톡·인스타 경로 폐기.

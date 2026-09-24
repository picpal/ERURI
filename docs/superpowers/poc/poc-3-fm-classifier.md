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

## 실기기에서 사용자가 할 일

1. **Mac에서 Apple Intelligence 상태 확인**: 이 실기기 절차는 Mac의 Xcode 시뮬레이터가 아니라 **iPhone 실기기**에서 실행해야 진짜 온디바이스 모델을 쓴다. iPhone 설정 → Apple Intelligence & Siri에서 Apple Intelligence를 켜고, 모델 다운로드가 "완료" 상태인지 확인한다(다운로드 중이면 `modelNotReady`가 나올 수 있다).
2. Xcode에서 실기기를 대상으로 선택하고 `⌘U`로 `AssistantCoreTests` 전체(또는 `AssistantCoreTests/FMClassifierTests`만)를 실행한다.
3. `testAvailabilityReturnsKnownValue`가 통과하는지 확인하고, 콘솔에 출력되는 `FMClassifier.availability()` 실제 값을 기록한다.
4. `testBenchmark`가 스킵되지 않고 실제로 200건을 도는지 확인한다.
   - 스킵되며 "availability()==available 이지만 실제 생성 실패"라는 메시지가 뜨면, 해당 실기기에서도 모델 에셋이 아직 준비되지 않은 것이다. 몇 시간 후(백그라운드 다운로드 완료 후) 재시도한다.
   - 스킵 사유가 `FM unavailable: deviceNotEligible`이면 그 기기는 Apple Intelligence 자체를 지원하지 않는 기종이다(iPhone 15 Pro 미만 등).
5. 벤치마크가 끝까지 돌면 콘솔의 `FM_BENCH ...` 로그와 App Group의 `fm_bench.txt`(ContentView의 poc.log 섹션 근처에서 직접 확인하거나 Xcode 컨테이너 다운로드로 확인)를 기록한다. 형식: `p95=<초>s personalPass=<n>/<100> noticeDrop=<n>/<100>`.
6. 위 수치를 `docs/superpowers/poc/results.md`(Task 13에서 생성)의 PoC-3 행에 옮겨 적는다. 이 문서 작성 시점에는 `results.md`가 아직 없어 여기 옮겨 적지 못했다.

## 판정 기준 (스펙 §14 PoC-3, 계획서 Step 2 임계값 기준)

- **통과**: `p95 < 3.0`초, `personalPass/personalTotal ≤ 0.02`(사적 대화를 알림으로 오분류하는 비율 2% 이하), `noticeDrop/noticeTotal ≤ 0.15`(진짜 알림을 놓치는 비율 15% 이하).
- **부분 통과**: 지연시간은 기준을 충족하나 정확도 임계값 중 하나만 못 미치는 경우 → 임계값 조정 또는 규칙 필터와의 역할 분담 재검토 대상으로 기록.
- **실패 / 대안 채택**: `availability()`가 어떤 조건에서도 `available`이 되지 않거나(테스트 기기가 지원 기종이 아님), 지연시간이 3초를 크게 초과하는 경우 → FM 분류 단계를 생략하고 규칙 필터 결과만으로 큐 적재 여부를 결정하는 대안(`CaptureIntent`의 `isChatApp` 조건부 폐기 로직만 유지)을 채택.

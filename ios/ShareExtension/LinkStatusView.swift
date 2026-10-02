import UIKit

/// 공유 시트 안 링크·사진 읽기 상태(스펙 §6, 계획 D8). 전체를 덮는 불투명 화면 — 웹뷰는 이 밑(루트 뷰의 맨 아래)에 붙어 보이지 않는다
final class LinkStatusView: UIView {
  private let label = UILabel()
  private let noteLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let close = UIButton(type: .system)
  private var closed = false
  private var waiter: CheckedContinuation<Void, Never>?
  private var closeWaiter: (() -> Void)?
  /// [닫기]: 작업 취소(대기 행은 호출 쪽이 앱에 넘긴다). 결과를 기다리지 않는다
  var onClose: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    for l in [label, noteLabel] {
      l.numberOfLines = 0
      l.textAlignment = .center
      l.adjustsFontForContentSizeCategory = true
    }
    label.font = .preferredFont(forTextStyle: .body)
    label.accessibilityIdentifier = "share-link-status"
    noteLabel.font = .preferredFont(forTextStyle: .caption1)
    noteLabel.textColor = .secondaryLabel
    noteLabel.isHidden = true
    noteLabel.accessibilityIdentifier = "share-link-note"
    close.setTitle("닫기", for: .normal)
    close.accessibilityIdentifier = "share-link-close"
    close.addAction(UIAction { [weak self] _ in self?.tapClose() }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [spinner, label, noteLabel, close])
    stack.axis = .vertical
    stack.spacing = 16
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  /// note = 저장 범위 한 줄(메인 판정 MR1) — 큐에 넣었을 때만
  func show(_ text: String, note: String? = nil, done: Bool = false) {
    label.text = text
    noteLabel.text = note
    noteLabel.isHidden = note == nil
    if done { spinner.stopAnimating() } else { spinner.startAnimating() }
  }

  /// 작업 결과와 [닫기] 중 먼저 온 쪽. 닫기면 nil — 작업 결과를 기다리지 않는다(Codex 2)
  func race<T: Sendable>(_ work: Task<T, Never>) async -> T? {
    if closed { return nil }
    let box = RaceBox<T>()
    return await withCheckedContinuation { (c: CheckedContinuation<T?, Never>) in
      box.cont = c
      closeWaiter = { box.finish(nil) }
      Task { @MainActor in box.finish(await work.value) }
    }
  }

  /// 결과를 보인 뒤: [닫기]를 누르거나 seconds 가 지나면 돌아온다(이미 닫기를 눌렀으면 바로)
  func waitClose(seconds: Double) async {
    if closed { return }
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
      waiter = c
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(seconds))
        self?.finish()
      }
    }
  }

  private func tapClose() {
    closed = true
    onClose?()
    closeWaiter?(); closeWaiter = nil
    finish()
  }
  private func finish() { waiter?.resume(); waiter = nil }
}

/// race 의 결과 상자: 먼저 온 값 하나만 넘긴다
@MainActor private final class RaceBox<T: Sendable> {
  var cont: CheckedContinuation<T?, Never>?
  func finish(_ v: T?) { cont?.resume(returning: v); cont = nil }
}

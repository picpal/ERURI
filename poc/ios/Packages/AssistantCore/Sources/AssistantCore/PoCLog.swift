import Foundation

public enum PoCLog {
  public static func append(_ line: String) {
    guard let dir = try? AppGroup.containerURL() else { return }
    let url = dir.appendingPathComponent("poc.log")
    appendLine(line, to: url, create: true)
  }

  /// O_APPEND 로 한 번에 쓴다. seek→write 는 동시 쓰기(동시 액션·앱과 확장)에서 서로의 줄을 덮어쓴다.
  static func appendLine(_ line: String, to url: URL, create: Bool) {
    let data = Data("[\(ISO8601DateFormatter().string(from: Date()))] \(line)\n".utf8)
    let fd = open(url.path, O_WRONLY | O_APPEND | (create ? O_CREAT : 0), 0o644)
    guard fd >= 0 else { return }
    defer { close(fd) }
    _ = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
  }

  public static func tail(lines: Int) -> [String] {
    guard let dir = try? AppGroup.containerURL(),
          let content = try? String(contentsOf: dir.appendingPathComponent("poc.log"), encoding: .utf8) else { return [] }
    let all = content.split(separator: "\n").map(String.init)
    return Array(all.suffix(lines))
  }
}

/// 첫 잠금 해제 전(BFU)에도 쓸 수 있는 흔적 로그. 보호 등급 none 이라 **내용 없이** 코드·길이만 남긴다.
/// poc.log·queue.sqlite(CUFUA)는 BFU 에서 열리지 않으므로 "자동화 미실행"과 "실행됐지만 파일 접근 실패"를 이것으로 구분한다.
public enum BFULog {
  static var url: URL? { try? AppGroup.containerURL().appendingPathComponent("bfu.log") }
  /// 앱 실행(잠금 해제 상태) 시 1회 호출해 보호 등급 none 파일을 만들어 둔다.
  public static func prepare() {
    guard let u = url, !FileManager.default.fileExists(atPath: u.path) else { return }
    FileManager.default.createFile(atPath: u.path, contents: nil, attributes: [.protectionKey: FileProtectionType.none])
  }
  public static func append(_ line: String) {
    guard let u = url else { return }
    PoCLog.appendLine(line, to: u, create: false)   // prepare() 가 만든 보호 등급 none 파일에만 쓴다
  }
  public static func tail(lines: Int) -> [String] {
    guard let u = url, let content = try? String(contentsOf: u, encoding: .utf8) else { return [] }
    return Array(content.split(separator: "\n").map(String.init).suffix(lines))
  }
}

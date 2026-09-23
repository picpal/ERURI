import Foundation

public enum PoCLog {
  public static func append(_ line: String) {
    guard let dir = try? AppGroup.containerURL() else { return }
    let url = dir.appendingPathComponent("poc.log")
    let entry = "[\(ISO8601DateFormatter().string(from: Date()))] \(line)\n"
    guard let data = entry.data(using: .utf8) else { return }
    if let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      handle.seekToEndOfFile()
      handle.write(data)
    } else {
      try? data.write(to: url)
    }
  }

  public static func tail(lines: Int) -> [String] {
    guard let dir = try? AppGroup.containerURL(),
          let content = try? String(contentsOf: dir.appendingPathComponent("poc.log"), encoding: .utf8) else { return [] }
    let all = content.split(separator: "\n").map(String.init)
    return Array(all.suffix(lines))
  }
}

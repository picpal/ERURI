import Foundation
public enum AppGroup {
  public static let id = "group.com.picpal.assistant"
  public enum Error: Swift.Error { case containerUnavailable }
  public static func containerURL() throws -> URL {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) else {
      throw Error.containerUnavailable
    }
    return url
  }
}

/// Share Extension 이 받은 파일을 App Group `inbox/` 에 영속화한다. 반환은 컨테이너 기준 상대 경로.
public enum ShareInbox {
  public static func persist(_ src: URL, id: String, ext: String) throws -> String {
    let dir = try AppGroup.containerURL().appendingPathComponent("inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dst = dir.appendingPathComponent(id + "." + ext)
    try FileManager.default.copyItem(at: src, to: dst)
    return "inbox/" + dst.lastPathComponent
  }
}

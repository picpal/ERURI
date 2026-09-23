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

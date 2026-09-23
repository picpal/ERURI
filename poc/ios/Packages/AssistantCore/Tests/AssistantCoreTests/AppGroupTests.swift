import XCTest
@testable import AssistantCore
final class AppGroupTests: XCTestCase {
  func testContainerExists() throws {
    let url = try AppGroup.containerURL()
    XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
  }
}

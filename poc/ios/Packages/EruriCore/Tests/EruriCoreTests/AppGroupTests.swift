import XCTest
@testable import EruriCore
final class AppGroupTests: XCTestCase {
  func testContainerExists() throws {
    let url = try AppGroup.containerURL()
    XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
  }
}

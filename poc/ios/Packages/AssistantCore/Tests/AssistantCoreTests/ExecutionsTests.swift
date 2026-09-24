import XCTest
@testable import AssistantCore
final class ExecutionsTests: XCTestCase {
  func make() throws -> Executions { try Executions(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)) }
  func testRecordThenExisting() throws {
    let e = try make(); try e.record(proposalId: "p1", eventkitId: "ek1")
    XCTAssertEqual(try e.existing(proposalId: "p1"), "ek1")
  }
  func testDuplicateRecordKeepsFirst() throws {
    let e = try make(); try e.record(proposalId: "p1", eventkitId: "ek1"); try e.record(proposalId: "p1", eventkitId: "ek2")
    XCTAssertEqual(try e.existing(proposalId: "p1"), "ek1")
    XCTAssertEqual(try e.unreported().count, 1)
  }
  func testMarkReported() throws {
    let e = try make(); try e.record(proposalId: "p1", eventkitId: "ek1"); try e.markReported(proposalId: "p1")
    XCTAssertTrue(try e.unreported().isEmpty)
  }
}

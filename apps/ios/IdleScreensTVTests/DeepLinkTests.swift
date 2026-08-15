import XCTest
@testable import IdleScreensTV

final class DeepLinkTests: XCTestCase {

    func testCanonicalTopShelfLink() {
        XCTAssertEqual(
            DeepLink.channelId(from: URL(string: "idlescreens://channel/noble-grove-6b")!),
            "noble-grove-6b")
    }

    func testBareShorthand() {
        XCTAssertEqual(
            DeepLink.channelId(from: URL(string: "idlescreens://lobby")!),
            "lobby")
    }

    func testWrongSchemeRejected() {
        XCTAssertNil(DeepLink.channelId(from: URL(string: "https://idlescreens.com/channel/lobby")!))
    }

    func testEmptyChannelRejected() {
        XCTAssertNil(DeepLink.channelId(from: URL(string: "idlescreens://channel/")!))
        XCTAssertNil(DeepLink.channelId(from: URL(string: "idlescreens://")!))
    }
}

import XCTest
@testable import IdleScreens

/// Attaching an existing channel means pasting two strings copied from
/// somewhere else. What people actually have on the clipboard is usually a
/// link, not a bare id — and the two token kinds in this system look alike
/// enough to swap by accident.
final class ChannelTokenFormatTests: XCTestCase {
    // MARK: Channel id

    func testBareIdPassesThrough() {
        XCTAssertEqual(ChannelTokenFormat.channelId(from: "ember-prism-05"), "ember-prism-05")
    }

    func testViewerLinkYieldsJustTheId() {
        XCTAssertEqual(
            ChannelTokenFormat.channelId(from: "https://idlescreens.com/channel/ember-prism-05"),
            "ember-prism-05")
    }

    func testChannelAPIPathYieldsJustTheId() {
        XCTAssertEqual(
            ChannelTokenFormat.channelId(from: "https://idlescreens.com/c/lobby/state"),
            "lobby")
    }

    func testIdIsRestrictedToTheServersCharset() {
        // The server strips the same way, so anything surviving here is
        // something it can actually look up.
        XCTAssertEqual(ChannelTokenFormat.channelId(from: "lob by!"), "lobby")
        XCTAssertNil(ChannelTokenFormat.channelId(from: "!!!"))
        XCTAssertNil(ChannelTokenFormat.channelId(from: "   "))
    }

    // MARK: Token

    func testPastedTokenTolerateseWhitespaceAndNewline() {
        XCTAssertEqual(ChannelTokenFormat.normalizeToken("  isk_abc123\n"), "isk_abc123")
        XCTAssertTrue(ChannelTokenFormat.isPlausibleToken(" isk_abc123 "))
    }

    func testPrefixIsCheckedBeforeSpendingARoundTrip() {
        XCTAssertNotNil(ChannelTokenFormat.tokenProblem("abc123"))
        XCTAssertNil(ChannelTokenFormat.tokenProblem("isk_abc123"))
        XCTAssertNil(ChannelTokenFormat.tokenProblem(""), "empty is not yet wrong")
    }

    /// The two token kinds are one character apart and do entirely different
    /// jobs — `isp_` pushes to a screen, `isk_` steers a channel. Naming the
    /// mix-up beats a generic "invalid token".
    func testPairTokenPastedIntoTheChannelFieldIsNamed() {
        let problem = ChannelTokenFormat.tokenProblem("isp_abc123")
        XCTAssertNotNil(problem)
        XCTAssertTrue(problem?.contains("pairing") ?? false,
                      "should say it's a pairing token, got: \(problem ?? "nil")")
    }

    func testTruncatedTokenIsCalledIncomplete() {
        XCTAssertNotNil(ChannelTokenFormat.tokenProblem("isk_"))
    }
}

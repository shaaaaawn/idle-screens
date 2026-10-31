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

// MARK: - Handoff links

extension ChannelTokenFormatTests {
    /// A handoff link grants control, so it must carry both halves. Treating a
    /// plain viewer link as a grant would silently "adopt" a channel the user
    /// has no token for — the exact listed-but-unsteerable state the token
    /// work went out of its way to eliminate.
    func testHandoffNeedsBothChannelAndToken() {
        let url = URL(string: "idlescreens://channel/lobby?token=isk_abc123")!
        let grant = ChannelTokenFormat.handoff(from: url)
        XCTAssertEqual(grant?.channelId, "lobby")
        XCTAssertEqual(grant?.token, "isk_abc123")
    }

    func testViewerLinkWithoutATokenIsNotAGrant() {
        let url = URL(string: "https://idlescreens.com/channel/lobby")!
        XCTAssertNil(ChannelTokenFormat.handoff(from: url))
    }

    /// A pair code is a different credential entirely; it must never be
    /// mistaken for channel control.
    func testPairLinkIsNotAHandoff() {
        let url = URL(string: "idlescreens://pair/K7M2PW")!
        XCTAssertNil(ChannelTokenFormat.handoff(from: url))
    }

    func testWrongTokenKindIsRejected() {
        let url = URL(string: "idlescreens://channel/lobby?token=isp_screenpair")!
        XCTAssertNil(ChannelTokenFormat.handoff(from: url),
                     "a screen pairing token grants nothing on a channel")
        let inFragment = URL(string: "idlescreens://channel/lobby#token=isp_screenpair")!
        XCTAssertNil(ChannelTokenFormat.handoff(from: inFragment),
                     "nor does it in the fragment")
    }

    /// The fragment form — what the app writes now, and what idlescreens.com
    /// requires for an editor or owner key — in both URL shapes.
    func testHandoffReadsTheTokenFromTheFragment() {
        let custom = ChannelTokenFormat.handoff(from: URL(string: "idlescreens://channel/lobby#token=isk_abc123")!)
        XCTAssertEqual(custom?.channelId, "lobby")
        XCTAssertEqual(custom?.token, "isk_abc123")

        let web = ChannelTokenFormat.handoff(
            from: URL(string: "https://idlescreens.com/channel/living-room/remote#token=isk_edit_9c1b")!)
        XCTAssertEqual(web?.channelId, "living-room")
        XCTAssertEqual(web?.token, "isk_edit_9c1b")

        // Other fragment keys around it are ignored.
        let mixed = ChannelTokenFormat.handoff(from: URL(string: "idlescreens://channel/lobby#add-to-ai&token=isk_abc123")!)
        XCTAssertEqual(mixed?.token, "isk_abc123")
    }

    func testFragmentWinsOverQueryWhenBothArePresent() {
        let url = URL(string: "idlescreens://channel/lobby?token=isk_old#token=isk_new")!
        XCTAssertEqual(ChannelTokenFormat.handoff(from: url)?.token, "isk_new")
    }

    func testAFragmentWithoutATokenIsNotAGrant() {
        XCTAssertNil(ChannelTokenFormat.handoff(from: URL(string: "https://idlescreens.com/channel/lobby#add-to-ai")!))
        XCTAssertNil(ChannelTokenFormat.handoff(from: URL(string: "idlescreens://channel/lobby#token=")!))
    }

    /// The link the app hands out round-trips through its own parser, with the
    /// token in the fragment and nothing in the query.
    func testHandoffLinkRoundTrips() throws {
        let link = ChannelTokenFormat.handoffLink(channelId: "living-room", token: "isk_edit_9c1b")
        XCTAssertEqual(link, "idlescreens://channel/living-room#token=isk_edit_9c1b")
        let url = try XCTUnwrap(URL(string: link))
        XCTAssertNil(url.query)
        let grant = try XCTUnwrap(ChannelTokenFormat.handoff(from: url))
        XCTAssertEqual(grant.channelId, "living-room")
        XCTAssertEqual(grant.token, "isk_edit_9c1b")
    }
}

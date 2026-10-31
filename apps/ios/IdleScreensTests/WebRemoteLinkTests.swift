import XCTest
@testable import IdleScreens

/// The link that carries a key to a desktop browser. The website's
/// `parseUrlToken` takes an editor or owner key only from `#token=` (it
/// refuses one in `?token=`, which reaches the server's logs — idle-server
/// #334), so the shape is a contract with idle-server, not a style choice.
final class WebRemoteLinkTests: XCTestCase {
    func testBuildsTheWebRemoteHandIn() {
        let url = PairedTVView.webRemoteLink(channelId: "living-room", token: "isk_edit_abc-123",
                                             baseURL: "https://idlescreens.com")
        XCTAssertEqual(url?.absoluteString, "https://idlescreens.com/channel/living-room/remote#token=isk_edit_abc-123")
    }

    /// The key never rides in the query string, whatever its role.
    func testTheKeyIsInTheFragmentNeverTheQuery() throws {
        let owner = "isk_" + String(repeating: "c", count: 32)
        let url = try XCTUnwrap(PairedTVView.webRemoteLink(channelId: "attic", token: owner,
                                                           baseURL: "https://idlescreens.com"))
        XCTAssertNil(url.query)
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.fragment, "token=\(owner)")
        XCTAssertEqual(url.path, "/channel/attic/remote")
    }

    /// The app reads its own share back (a universal link opened on a phone).
    func testTheAppParsesItsOwnWebRemoteLink() throws {
        let url = try XCTUnwrap(PairedTVView.webRemoteLink(channelId: "living-room", token: "isk_edit_abc-123",
                                                           baseURL: "https://idlescreens.com"))
        let grant = try XCTUnwrap(ChannelTokenFormat.handoff(from: url))
        XCTAssertEqual(grant.channelId, "living-room")
        XCTAssertEqual(grant.token, "isk_edit_abc-123")
    }

    func testRefusesAnythingTheSiteWouldRefuse() {
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: nil))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "not-a-key"))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "isk_abc\n"))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "isk_abc&x=1"))
    }
}

import XCTest
@testable import IdleScreens

/// The link that carries a key to a desktop browser. The website's
/// `takeTokenFromUrl` only accepts `?token=isk_…` on a channel page, so the
/// shape is a contract with idle-server, not a style choice.
final class WebRemoteLinkTests: XCTestCase {
    func testBuildsTheWebRemoteHandIn() {
        let url = PairedTVView.webRemoteLink(channelId: "living-room", token: "isk_edit_abc-123",
                                             baseURL: "https://idlescreens.com")
        XCTAssertEqual(url?.absoluteString, "https://idlescreens.com/channel/living-room/remote?token=isk_edit_abc-123")
    }

    func testRefusesAnythingTheSiteWouldRefuse() {
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: nil))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "not-a-key"))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "isk_abc\n"))
        XCTAssertNil(PairedTVView.webRemoteLink(channelId: "a", token: "isk_abc&x=1"))
    }
}

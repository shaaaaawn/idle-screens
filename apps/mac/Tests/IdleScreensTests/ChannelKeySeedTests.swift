import XCTest

@testable import IdleScreens

/// The key a private channel's page is handed (`ChannelKeySeed`).
final class ChannelKeySeedTests: XCTestCase {
  let server = URL(string: "https://idlescreens.com")!
  let viewer = "isk_view_0123456789abcdef0123456789abcdef"

  func testOnlyAChannelPageOnTheServerIsSeeded() {
    let keys: (String) -> String? = { $0 == "wall" ? self.viewer : nil }
    let script = ChannelKeySeed.script(
      for: URL(string: "https://idlescreens.com/channel/wall?device=mac-1")!, server: server, key: keys)
    XCTAssertNotNil(script)
    XCTAssertTrue(script!.contains("\"isk:wall\""))
    XCTAssertTrue(script!.contains("\"https:\\/\\/idlescreens.com\"") || script!.contains("\"https://idlescreens.com\""))
    XCTAssertNotNil(ChannelKeySeed.script(for: URL(string: "https://idlescreens.com/c/wall")!, server: server, key: keys))

    // Another origin, another channel, no key, not a channel page: nothing.
    XCTAssertNil(ChannelKeySeed.script(for: URL(string: "https://evil.example/channel/wall")!, server: server, key: keys))
    XCTAssertNil(ChannelKeySeed.script(for: URL(string: "http://idlescreens.com/channel/wall")!, server: server, key: keys))
    XCTAssertNil(ChannelKeySeed.script(for: URL(string: "https://idlescreens.com/channel/lobby")!, server: server, key: keys))
    XCTAssertNil(ChannelKeySeed.script(for: URL(string: "https://idlescreens.com/remote/wall")!, server: server, key: keys))
  }

  func testTheLocalServerPortCounts() {
    let local = URL(string: "http://localhost:8781")!
    let keys: (String) -> String? = { _ in self.viewer }
    XCTAssertNotNil(ChannelKeySeed.script(for: URL(string: "http://localhost:8781/channel/wall")!, server: local, key: keys))
    XCTAssertNil(ChannelKeySeed.script(for: URL(string: "http://localhost:8787/channel/wall")!, server: local, key: keys))
    XCTAssertEqual(ChannelKeySeed.origin(of: local), "http://localhost:8781")
  }

  func testAMalformedKeyIsNeverEmbedded() {
    for bad in ["isk_view_abc\n", "isk_view_\");alert(1);//", "not-a-key", "isk_"] {
      XCTAssertNil(
        ChannelKeySeed.script(for: URL(string: "https://idlescreens.com/channel/wall")!, server: server, key: { _ in bad }),
        bad)
    }
  }

  func testAChannelIdOutsideTheServersShapeIsNotOne() {
    XCTAssertNil(ChannelKeySeed.channelId(in: URL(string: "https://idlescreens.com/channel/a%22b")!, server: server))
    XCTAssertEqual(ChannelKeySeed.channelId(in: URL(string: "https://idlescreens.com/channel/a-b_c/remote")!, server: server), "a-b_c")
  }
}

import XCTest

@testable import IdleScreens

/// The server relays its JSON error body verbatim through MCP, so both the
/// "is this the capability gate?" test and the message the user reads are
/// parsing that shape. Strings captured from a live local server.
final class ChannelTokenTests: XCTestCase {
  private let protectedBody = """
    {
      "error": "This channel is protected. A valid token is required to write to it."
    }
    """

  func testProtectionIsDetectedFromTheServerBody() {
    let message = ChannelClient.readableError(protectedBody)
    XCTAssertEqual(
      message, "This channel is protected. A valid token is required to write to it.")
    XCTAssertTrue(ChannelToken.isProtectionFailure(message ?? ""))
  }

  func testOtherFailuresDoNotAskForAToken() {
    let rateLimited = """
      {"error": "Rate limit: at most 30 changes per minute per channel. Slow down and retry shortly."}
      """
    let message = ChannelClient.readableError(rateLimited) ?? ""
    XCTAssertTrue(message.hasPrefix("Rate limit:"))
    XCTAssertFalse(ChannelToken.isProtectionFailure(message))
    XCTAssertFalse(ChannelToken.isProtectionFailure("Server returned HTTP 500."))
  }

  func testReadableErrorPassesPlainTextThrough() {
    XCTAssertEqual(ChannelClient.readableError("Publish failed."), "Publish failed.")
    XCTAssertNil(ChannelClient.readableError(""))
    XCTAssertNil(ChannelClient.readableError(nil))
  }

  func testKeychainRoundTrip() throws {
    let channel = "test-channel-\(UInt32.random(in: 0...UInt32.max))"
    defer { ChannelToken.delete(for: channel) }
    XCTAssertNil(ChannelToken.load(for: channel))
    try XCTSkipUnless(
      ChannelToken.save("isk_test_value", for: channel),
      "Keychain unavailable in this environment")
    XCTAssertEqual(ChannelToken.load(for: channel), "isk_test_value")
    // Saving again replaces rather than duplicating (SecItemAdd would fail).
    XCTAssertTrue(ChannelToken.save("isk_second", for: channel))
    XCTAssertEqual(ChannelToken.load(for: channel), "isk_second")
    ChannelToken.delete(for: channel)
    XCTAssertNil(ChannelToken.load(for: channel))
  }
}

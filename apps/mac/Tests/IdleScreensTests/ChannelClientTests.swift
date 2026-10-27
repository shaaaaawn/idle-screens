import XCTest

@testable import IdleScreens

/// "Cast this Mac" against idle-server PR #250's MCP contract: the write
/// carries `intent` + `harness` (no `agent` — no AI acts here, as in the web
/// UI), the UA is not the shipped-build compatibility one, and errors read
/// from `structuredContent.error`.
final class ChannelClientTests: XCTestCase {
  func testCastPayloadIsAttributed() throws {
    let payload = ChannelClient.castPayload(
      saverId: "warp", channelId: "den", seed: 0xFFFF_FFFF, token: "isk_x")
    XCTAssertEqual(payload["method"] as? String, "tools/call")
    let params = try XCTUnwrap(payload["params"] as? [String: Any])
    XCTAssertEqual(params["name"] as? String, "publishScene")
    let args = try XCTUnwrap(params["arguments"] as? [String: Any])
    XCTAssertEqual(args["channelId"] as? String, "den")
    XCTAssertEqual(args["token"] as? String, "isk_x")
    XCTAssertEqual(args["seed"] as? Int, 0x7FFF_FFFF)
    XCTAssertEqual(args["harness"] as? String, "idlescreens-mac")
    XCTAssertEqual(args["intent"] as? String, "user cast warp from the Mac menu bar")
    XCTAssertNil(args["agent"])
    XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: payload))
  }

  func testCastPayloadWithoutTokenOmitsIt() throws {
    let payload = ChannelClient.castPayload(saverId: "warp", channelId: "lobby", seed: 1, token: nil)
    let args = (payload["params"] as? [String: Any])?["arguments"] as? [String: Any]
    XCTAssertNil(args?["token"])
  }

  func testUserAgentIsNotTheShippedBuildOne() {
    let ua = ChannelClient.userAgent
    XCTAssertNil(ua.range(of: #"^IdleScreens(TV)?/\S+ CFNetwork/"#, options: .regularExpression))
    XCTAssertFalse(ua.lowercased().contains("pi"), ua)
    XCTAssertTrue(ua.hasPrefix("IdleScreens-macOS/"), ua)
  }

  private func reply(_ result: String) -> Data { Data(#"{"jsonrpc":"2.0","id":1,"result":\#(result)}"#.utf8) }

  func testSuccessHasNoFailureMessage() {
    XCTAssertNil(
      ChannelClient.failureMessage(
        reply(#"{"content":[{"type":"text","text":"{}"}],"structuredContent":{"confirmed":true}}"#)))
  }

  func testEnvelopeMessageWins() {
    let data = reply(
      #"{"isError":true,"content":[{"type":"text","text":"{\"error\":\"old text\"}"}],"structuredContent":{"error":{"code":"attribution_required","message":"publishScene changes a channel, so it needs `intent`.","hint":"Re-send with intent, e.g. {}","retryable":true}}}"#
    )
    XCTAssertEqual(
      ChannelClient.failureMessage(data), "publishScene changes a channel, so it needs `intent`.")
  }

  func testHumanHintIsAppendedForRateLimits() {
    let data = reply(
      #"{"isError":true,"content":[{"type":"text","text":"x"}],"structuredContent":{"error":{"code":"rate_limited","message":"Rate limit hit.","hint":"Wait a minute.","retryable":true}}}"#
    )
    XCTAssertEqual(ChannelClient.failureMessage(data), "Rate limit hit. Wait a minute.")
  }

  /// The token prompt keys on the protection sentence; it must survive the envelope.
  func testProtectionFailureStillPromptsForAToken() {
    let sentence = "This channel is protected. A valid token is required to write to it."
    let data = reply(
      #"{"isError":true,"content":[{"type":"text","text":"{\"error\":\"\#(sentence)\"}"}],"structuredContent":{"error":{"code":"unauthorized","message":"\#(sentence)","hint":"Pass the channel's token","retryable":false}}}"#
    )
    let message = ChannelClient.failureMessage(data) ?? ""
    XCTAssertEqual(message, sentence)
    XCTAssertTrue(ChannelToken.isProtectionFailure(message))
  }

  func testOldServerTextErrorStillReads() {
    let data = reply(
      #"{"isError":true,"content":[{"type":"text","text":"{\"error\":\"Rate limit: slow down.\"}"}]}"#)
    XCTAssertEqual(ChannelClient.failureMessage(data), "Rate limit: slow down.")
  }

  func testGarbageIsAFailure() {
    XCTAssertNotNil(ChannelClient.failureMessage(Data("not json".utf8)))
    XCTAssertNotNil(ChannelClient.failureMessage(nil))
  }
}

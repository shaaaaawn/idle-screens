import XCTest

@testable import IdleScreens

/// The default path must keep producing the exact production URLs — a
/// regression here breaks pairing and casting for shipped builds.
final class ServerEndpointTests: XCTestCase {
  private let prod = URL(string: "https://idlescreens.com")!

  func testProductionURLsUnchanged() {
    XCTAssertEqual(
      ServerEndpoint.url("/api/pair/new", base: prod)?.absoluteString,
      "https://idlescreens.com/api/pair/new")
    XCTAssertEqual(
      ServerEndpoint.url("/mcp", base: prod)?.absoluteString, "https://idlescreens.com/mcp")
    XCTAssertEqual(
      ServerEndpoint.url(
        "/channel/default", query: [URLQueryItem(name: "device", value: "mac-abc")], base: prod)?
        .absoluteString,
      "https://idlescreens.com/channel/default?device=mac-abc")
    XCTAssertEqual(
      ServerEndpoint.socketURL(
        "/c/default/ws", query: [URLQueryItem(name: "device", value: "mac-abc")], base: prod)?
        .absoluteString,
      "wss://idlescreens.com/c/default/ws?device=mac-abc")
  }

  func testLocalBaseUsesPlainSocketScheme() {
    let local = ServerEndpoint.base(from: "http://localhost:8787")
    XCTAssertEqual(
      ServerEndpoint.url("/channel/default", base: local)?.absoluteString,
      "http://localhost:8787/channel/default")
    XCTAssertEqual(
      ServerEndpoint.socketURL("/c/default/ws", base: local)?.absoluteString,
      "ws://localhost:8787/c/default/ws")
  }

  func testBaseFallsBackToProduction() {
    XCTAssertEqual(ServerEndpoint.base(from: nil), prod)
    XCTAssertEqual(ServerEndpoint.base(from: "   "), prod)
    XCTAssertEqual(ServerEndpoint.base(from: "localhost:8787"), prod)  // no scheme
    XCTAssertEqual(ServerEndpoint.base(from: "not a url"), prod)
  }

  func testTrailingSlashesAreTrimmed() {
    XCTAssertEqual(
      ServerEndpoint.base(from: "http://localhost:8787//").absoluteString, "http://localhost:8787")
  }
}

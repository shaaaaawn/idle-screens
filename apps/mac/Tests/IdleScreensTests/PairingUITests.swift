import XCTest

@testable import IdleScreens

/// The pairing UI is two data paths dressed up: what the server sends back
/// from /api/pair/new, and what a phone's camera would actually read off the
/// QR. Both are checkable without a screen.
final class PairingUITests: XCTestCase {

  // MARK: Mint response

  /// Shape captured from a live server response.
  func testParsesUrlAndExpiryFromTheServer() {
    let expires = Date().addingTimeInterval(300)
    let pair = PairDevice.parse(
      code: "K7MPQ2",
      from: [
        "code": "K7MPQ2",
        "url": "https://idlescreens.com/pair/K7MPQ2",
        "expiresAt": expires.timeIntervalSince1970 * 1000,
      ])
    XCTAssertEqual(pair.code, "K7MPQ2")
    XCTAssertEqual(pair.url?.absoluteString, "https://idlescreens.com/pair/K7MPQ2")
    let remaining = try? XCTUnwrap(pair.secondsRemaining)
    XCTAssertEqual(remaining ?? 0, 300, accuracy: 2)
  }

  /// A server that omits the extras still pairs — the code is what matters;
  /// the QR falls back to a locally built link and the countdown goes quiet.
  func testFallsBackWhenTheServerOmitsExtras() {
    let pair = PairDevice.parse(code: "K7MPQ2", from: ["code": "K7MPQ2"])
    XCTAssertNil(pair.expiresAt)
    XCTAssertNil(pair.secondsRemaining)
    XCTAssertEqual(pair.url?.path, "/pair/K7MPQ2")
  }

  /// Captured from a local wrangler on :8787, which answers with the *prod*
  /// host. Scanning that QR would send the phone to a server where the code
  /// doesn't exist, so the link has to fall back to the server we minted from.
  func testIgnoresAServerLinkForADifferentHost() {
    let pair = PairDevice.parse(
      code: "26UUNM",
      from: ["code": "26UUNM", "url": "http://idlescreens.com/pair/26UUNM"])
    XCTAssertEqual(pair.url?.host, ServerEndpoint.base.host)
    XCTAssertEqual(pair.url?.path, "/pair/26UUNM")
  }

  // MARK: QR

  /// Encode → decode: proves the image a phone points at carries the pairing
  /// link, not just that some image was produced.
  func testQRRoundTripsThePairingLink() throws {
    let link = "https://idlescreens.com/pair/K7MPQ2"
    let image = try XCTUnwrap(QRCode.image(for: link))
    XCTAssertEqual(QRCode.decode(image), link)
  }

  func testQRIsRenderedAtTheRequestedSize() throws {
    let image = try XCTUnwrap(QRCode.image(for: "https://idlescreens.com/pair/K7MPQ2", size: 180))
    XCTAssertEqual(image.size.width, 180, accuracy: 1)
    XCTAssertEqual(image.size.height, 180, accuracy: 1)
  }

  /// A longer payload (channel URL with a device query) must still decode —
  /// QR capacity scales with version, but a silent encoder failure would show
  /// as a blank box in the window.
  func testQRHandlesALongerChannelURL() throws {
    let link = "https://idlescreens.com/channel/evals-neo-expressive-scrawl?device=mac-41f869e9-87e2-4c28-80aa-616449026f4c"
    let image = try XCTUnwrap(QRCode.image(for: link))
    XCTAssertEqual(QRCode.decode(image), link)
  }

  func testEmptyPayloadProducesNoImage() {
    XCTAssertNil(QRCode.image(for: ""))
  }
}

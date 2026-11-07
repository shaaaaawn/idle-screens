import CryptoKit
import XCTest
@testable import IdleScreensTV

/// A private channel's viewer key, sealed by the phone and opened by the TV
/// (`PairKeySeal`; idle-server capability-auth.md "Native screens").
final class PairKeySealTests: XCTestCase {
    private let viewer = "isk_view_0123456789abcdef0123456789abcdef"
    private let tv = Curve25519.KeyAgreement.PrivateKey()
    private var tvPublic: String { Base64URL.encode(tv.publicKey.rawRepresentation) }

    func testTheScreenOpensWhatThePhoneSealedForIt() throws {
        let sealed = try PairKeySeal.seal(token: viewer, to: tvPublic, deviceId: "tv-1", channelId: "wall")
        XCTAssertEqual(PairKeySeal.open(sealed, with: tv, deviceId: "tv-1", channelId: "wall"), viewer)
    }

    func testTheBlobFitsTheServersBound() throws {
        let sealed = try PairKeySeal.seal(token: viewer, to: tvPublic, deviceId: "tv-1", channelId: "wall")
        // idle-server pair-push.ts SEALED_KEY: 64-256 chars of unpadded base64url.
        XCTAssertTrue((64...256).contains(sealed.count), "\(sealed.count)")
        XCTAssertTrue(sealed.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        XCTAssertEqual(Base64URL.encode(tv.publicKey.rawRepresentation).count, 43, "the public key the server checks for")
    }

    func testABlobOpensOnlyForTheDeviceAndChannelItWasSealedFor() throws {
        let sealed = try PairKeySeal.seal(token: viewer, to: tvPublic, deviceId: "tv-1", channelId: "wall")
        XCTAssertNil(PairKeySeal.open(sealed, with: tv, deviceId: "tv-2", channelId: "wall"),
                     "a socket claiming another device id gets nothing")
        XCTAssertNil(PairKeySeal.open(sealed, with: tv, deviceId: "tv-1", channelId: "other"),
                     "relabelled for another channel, it does not open")
        XCTAssertNil(PairKeySeal.open(sealed, with: Curve25519.KeyAgreement.PrivateKey(), deviceId: "tv-1", channelId: "wall"),
                     "another screen's private key cannot open it")
    }

    func testAScreenAcceptsOnlyAViewerKey() throws {
        for key in ["isk_edit_0123456789abcdef0123456789abcdef", "isk_0123456789abcdef0123456789abcdef", "not a key"] {
            let sealed = try PairKeySeal.seal(token: key, to: tvPublic, deviceId: "tv-1", channelId: "wall")
            XCTAssertNil(PairKeySeal.open(sealed, with: tv, deviceId: "tv-1", channelId: "wall"), key)
        }
    }

    func testGarbageNeverOpensOrCrashes() {
        for blob in ["", "AAAA", String(repeating: "A", count: 120), "!!notbase64!!"] {
            XCTAssertNil(PairKeySeal.open(blob, with: tv, deviceId: "tv-1", channelId: "wall"), blob)
        }
        XCTAssertThrowsError(try PairKeySeal.seal(token: viewer, to: "short", deviceId: "tv-1", channelId: "wall"))
    }

    func testBase64URLRoundTrips() {
        let bytes = Data((0...255).map(UInt8.init))
        let text = Base64URL.encode(bytes)
        XCTAssertFalse(text.contains("=") || text.contains("+") || text.contains("/"))
        XCTAssertEqual(Base64URL.decode(text), bytes)
        XCTAssertNil(Base64URL.decode("ab+c"))
    }

    func testTheSwitchFrameCarriesTheSealedKey() {
        let event = ChannelWSClient.parse(#"{"type":"switch","channelId":"wall","sealedKey":"abc_-"}"#)
        XCTAssertEqual(event, .switchChannel(channelId: "wall", sceneId: nil, sealedKey: "abc_-"))
        XCTAssertEqual(ChannelWSClient.parse(#"{"type":"switch","channelId":"wall"}"#), .switchChannel(channelId: "wall"))
    }
}

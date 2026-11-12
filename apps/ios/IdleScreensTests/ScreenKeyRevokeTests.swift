import CryptoKit
import XCTest
@testable import IdleScreens

/// Unpairing a TV revokes the viewer keys this phone minted for it (the
/// follow-up #412 left open): a sold or lost TV must not keep opening a
/// private channel. Each minted key is kept with its grant id, the person
/// confirms once in the unpair dialog, and a key that is already dead is
/// only forgotten.
@MainActor
final class ScreenKeyRevokeTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!
    private let suiteName = "IdleScreensTests.ScreenKeyRevoke"
    private var defaults: UserDefaults!
    private let channelId = "revoke-chan"
    private let owner = "isk_0123456789abcdef0123456789abcdef"
    private let viewer = "isk_view_00112233445566778899aabbccddeeff"
    /// sha256("isk_view_00112233445566778899aabbccddeeff")[0..12], computed with shasum.
    private let viewerGrantId = "ccf74171a253"
    private var screen: PairedScreen!
    private var slot: String { AppState.screenViewerKeyKey(deviceId: screen.deviceId, channelId: channelId) }

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
        let publicKey = Base64URL.encode(Curve25519.KeyAgreement.PrivateKey().publicKey.rawRepresentation)
        screen = PairedScreen(deviceId: UUID().uuidString, channelId: nil, pairedAt: Date(), lastSeenAt: nil,
                              publicKey: publicKey)
    }

    override func tearDown() {
        KeychainHelper.delete(key: slot)
        KeychainHelper.delete(key: CredentialStore.tokenKey(for: channelId))
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: Helpers

    nonisolated private static func mcpReply(_ text: String) -> Data { MockTransport.mcpEnvelope(resultText: text) }

    nonisolated private static let confirmReply = Data(#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"error\":\"This revokes the key.\"}"}],"isError":true,"structuredContent":{"error":{"code":"confirmation_required","message":"This revokes the key.","retryable":true,"requestState":"cfm1.9.xyz"}}}}"#.utf8)

    nonisolated private static func tool(_ request: URLRequest) -> (name: String, args: [String: Any])? {
        guard request.url?.path == "/mcp", let body = request.httpBody,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let params = object["params"] as? [String: Any], let name = params["name"] as? String else { return nil }
        return (name, params["arguments"] as? [String: Any] ?? [:])
    }

    /// An app that owns `channelId`, with a confirmer that fails the test: the
    /// unpair dialog is the only question the person is asked.
    private func makeApp(role: ChannelRole = .owner,
                         handler: @escaping @Sendable (URLRequest) -> (Data, Int)) -> (AppState, MockTransport) {
        let transport = MockTransport()
        transport.handler = handler
        let store = CredentialStore(userDefaults: defaults)
        store.setToken(owner, for: channelId)
        store.save([ChannelCredential(channelId: channelId, label: "Lanterns", createdAt: Date(), role: role)])
        let mcp = MCPClient(baseURL: baseURL, transport: transport) { request in
            XCTFail("asked again after the unpair dialog: \(request.tool)")
            return false
        }
        let app = AppState(mcp: mcp, gallery: GalleryClient(baseURL: baseURL, transport: transport), store: store)
        app.pairedScreens = [screen]
        return (app, transport)
    }

    private func calls(_ transport: MockTransport, _ name: String) -> [[String: Any]] {
        transport.requests.compactMap(Self.tool).filter { $0.name == name }.map(\.args)
    }

    // MARK: The slot

    func testASlotHoldsTheGrantOrALegacyBareTokenAndNothingElse() {
        let grant = AppState.ScreenGrant(id: "abc123abc123", token: viewer)
        XCTAssertEqual(AppState.decodeScreenGrant(AppState.encodeScreenGrant(grant)), grant)
        XCTAssertEqual(AppState.decodeScreenGrant(viewer), AppState.ScreenGrant(id: nil, token: viewer))
        XCTAssertNil(AppState.decodeScreenGrant("not a key"))
        XCTAssertNil(AppState.decodeScreenGrant(#"{"id":"x","token":"isk_bad key"}"#))
    }

    func testTheDerivedIdIsTheServersGrantId() {
        XCTAssertEqual(AppState.grantId(ofToken: viewer), viewerGrantId)
    }

    func testAMintedKeyIsKeptWithItsId() async throws {
        let viewer = self.viewer
        let (app, _) = makeApp { request in
            if request.url?.path.hasSuffix("/verify") == true {
                return (Data(#"{"valid":true,"role":"owner","access":"private"}"#.utf8), 200)
            }
            if Self.tool(request)?.name == "createToken" {
                return (Self.mcpReply(#"{"id":"feedfacecafe","token":"\#(viewer)","role":"viewer"}"#), 200)
            }
            return (Data(), 404)
        }
        let sealed = try await app.sealedViewerKey(channelId: channelId, for: screen)
        XCTAssertNotNil(sealed)
        XCTAssertEqual(AppState.loadScreenGrant(slot: slot), AppState.ScreenGrant(id: "feedfacecafe", token: viewer))
    }

    // MARK: Unpair

    func testUnpairRevokesTheKeptKeyByItsIdWithoutAskingAgain() async {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, transport) = makeApp { request in
            if request.url?.path.hasSuffix("/verify") == true {
                return (Data(#"{"valid":true,"role":"viewer","access":"private"}"#.utf8), 200)
            }
            if let call = Self.tool(request), call.name == "revokeToken" {
                return call.args["confirm"] == nil ? (Self.confirmReply, 200) : (Self.mcpReply(#"{"ok":true}"#), 200)
            }
            return (Data(), 404)
        }
        XCTAssertEqual(app.screenKeys(for: screen).map(\.channelId), [channelId])

        let failed = await app.unpair(screen, revokeKeys: true)

        XCTAssertEqual(failed, [])
        XCTAssertTrue(app.pairedScreens.isEmpty)
        let revokes = calls(transport, "revokeToken")
        XCTAssertEqual(revokes.count, 2, "asked, then confirmed with the server's token")
        XCTAssertEqual(revokes.last?["id"] as? String, "feedfacecafe")
        XCTAssertEqual(revokes.last?["token"] as? String, owner, "revoked with the owner key, never the viewer's")
        XCTAssertEqual(revokes.last?["confirm"] as? String, "cfm1.9.xyz")
        XCTAssertNil(KeychainHelper.load(key: slot))
        XCTAssertNil(app.pairPushError)
    }

    func testAKeyAlreadyDeadIsForgottenNotRevoked() async {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, transport) = makeApp { request in
            if request.url?.path.hasSuffix("/verify") == true {
                return (Data(#"{"valid":false,"role":null}"#.utf8), 200)
            }
            return (Data(), 404)
        }
        let failed = await app.unpair(screen, revokeKeys: true)
        XCTAssertEqual(failed, [])
        XCTAssertTrue(calls(transport, "revokeToken").isEmpty)
        XCTAssertNil(KeychainHelper.load(key: slot))
    }

    func testALegacySlotIsRevokedOnlyByAnIdTheChannelLists() async {
        KeychainHelper.save(key: slot, value: viewer)
        let grantId = viewerGrantId
        let (app, transport) = makeApp { request in
            if request.url?.path.hasSuffix("/verify") == true {
                return (Data(#"{"valid":true,"role":"viewer","access":"private"}"#.utf8), 200)
            }
            switch Self.tool(request)?.name {
            case "listTokens":
                return (Self.mcpReply(#"{"access":"private","tokens":[{"id":"\#(grantId)","role":"viewer","label":"Apple TV x"}]}"#), 200)
            case "revokeToken":
                return (Self.mcpReply(#"{"ok":true}"#), 200)
            default:
                return (Data(), 404)
            }
        }
        let failed = await app.unpair(screen, revokeKeys: true)
        XCTAssertEqual(failed, [])
        XCTAssertEqual(calls(transport, "revokeToken").first?["id"] as? String, grantId)
        XCTAssertNil(KeychainHelper.load(key: slot))
    }

    func testALegacySlotWhoseIdIsNotListedIsReportedAndKept() async {
        KeychainHelper.save(key: slot, value: viewer)
        let (app, transport) = makeApp { request in
            if request.url?.path.hasSuffix("/verify") == true {
                return (Data(#"{"valid":true,"role":"viewer","access":"private"}"#.utf8), 200)
            }
            if Self.tool(request)?.name == "listTokens" {
                return (Self.mcpReply(#"{"access":"private","tokens":[{"id":"000000000000","role":"viewer"}]}"#), 200)
            }
            return (Data(), 404)
        }
        let failed = await app.unpair(screen, revokeKeys: true)
        XCTAssertEqual(failed, ["Lanterns"])
        XCTAssertTrue(calls(transport, "revokeToken").isEmpty, "never revoke a guessed id")
        XCTAssertNotNil(KeychainHelper.load(key: slot), "kept, so the key can still be found and revoked")
        XCTAssertTrue(app.pairedScreens.isEmpty, "the unpair itself still happens")
        XCTAssertTrue(app.pairPushError?.contains(AppState.screenKeyLabel(screen)) == true)
    }

    func testANetworkFailureKeepsTheSlotAndSaysSo() async {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, transport) = makeApp { _ in (Data(#"{"error":"down"}"#.utf8), 503) }
        let failed = await app.unpair(screen, revokeKeys: true)
        XCTAssertEqual(failed, ["Lanterns"])
        XCTAssertTrue(calls(transport, "revokeToken").isEmpty)
        XCTAssertNotNil(KeychainHelper.load(key: slot))
    }

    /// Found in the sim run: a key added by link is kept under its id, so the
    /// dialog said "quiet-aurora-b1". It names the channel as the wall does.
    func testTheDialogNamesTheChannelAsTheWallDoes() {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, _) = makeApp { _ in (Data(), 404) }
        app.credentials = [ChannelCredential(channelId: channelId, label: channelId, createdAt: Date(), role: .owner)]
        XCTAssertEqual(app.screenKeys(for: screen).first?.channelLabel, channelId, "no wall row: the keyring's label")
        app.channels = [PublicChannel(channelId: channelId, label: "Lanterns (sim 433)", tags: nil, viewers: nil,
                                      access: "private")]
        XCTAssertEqual(app.screenKeys(for: screen).first?.channelLabel, "Lanterns (sim 433)")
    }

    func testOnlyAnOwnerIsOfferedTheRevoke() {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, _) = makeApp(role: .editor) { _ in (Data(), 404) }
        XCTAssertTrue(app.screenKeys(for: screen).isEmpty, "an editor cannot revoke, so it is not offered")
    }

    func testUnpairWithoutRevokeLeavesTheKey() async {
        KeychainHelper.save(key: slot, value: AppState.encodeScreenGrant(.init(id: "feedfacecafe", token: viewer)))
        let (app, transport) = makeApp { _ in (Data(), 404) }
        let failed = await app.unpair(screen, revokeKeys: false)
        XCTAssertEqual(failed, [])
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertNotNil(KeychainHelper.load(key: slot))
        XCTAssertTrue(app.pairedScreens.isEmpty)
    }

    func testTheDialogNamesWhatItRevokes() {
        let key = AppState.HeldScreenKey(channelId: channelId, channelLabel: "Lanterns", slot: slot,
                                         grant: .init(id: "feedfacecafe", token: viewer))
        let message = PairedTVView.unpairMessage(screen, keys: [key])
        XCTAssertTrue(message.contains("Lanterns"))
        XCTAssertTrue(message.contains("Apple TV"))
    }
}

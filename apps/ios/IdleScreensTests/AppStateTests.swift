import XCTest
@testable import IdleScreens

@MainActor
final class AppStateTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!
    private let suiteName = "IdleScreensTests"
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func makeApp(handler: @escaping @Sendable (URLRequest) throws -> (Data, Int)) -> AppState {
        let transport = MockTransport()
        transport.handler = handler
        return AppState(
            mcp: MCPClient(baseURL: baseURL, transport: transport),
            gallery: GalleryClient(baseURL: baseURL, transport: transport),
            store: CredentialStore(userDefaults: defaults)
        )
    }

    func testCreateChannelStoresCredentialAndToken() async throws {
        let app = makeApp { request in
            if request.url?.path == "/mcp" {
                return (MockTransport.mcpEnvelope(
                    resultText: #"{"channelId":"test-chan","token":"isk_0123456789abcdef0123456789abcdef"}"#
                ), 200)
            }
            return (Data(), 404)
        }
        defer { app.store.removeToken(for: "test-chan") }

        let token = try await app.createChannel(label: "my channel", tags: ["ambient"])

        XCTAssertEqual(token, "isk_0123456789abcdef0123456789abcdef")
        XCTAssertEqual(app.credentials.map(\.channelId), ["test-chan"])
        XCTAssertEqual(app.credentials.first?.label, "my channel")
        XCTAssertEqual(app.token(for: "test-chan"), token)
        // Persisted across reloads.
        XCTAssertEqual(app.store.load().map(\.channelId), ["test-chan"])
    }

    func testVerifyGateBlocksUnverifiedAdd() async {
        let app = makeApp { _ in
            (Data("forbidden".utf8), 403)
        }

        do {
            try await app.addExistingChannel(channelId: "someone-elses", token: "isk_wrong")
            XCTFail("Expected tokenDeclined")
        } catch let error as VJError {
            guard case .tokenDeclined(let channelId) = error else {
                return XCTFail("Wrong VJError: \(error)")
            }
            XCTAssertEqual(channelId, "someone-elses")
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
        XCTAssertTrue(app.credentials.isEmpty)
        XCTAssertNil(app.token(for: "someone-elses"))
    }

    func testVerifyGateAcceptsApprovedToken() async throws {
        let app = makeApp { request in
            if request.url?.path == "/c/shared-chan/verify" {
                return (Data(#"{"approved":true}"#.utf8), 200)
            }
            return (Data(), 404)
        }
        defer { app.store.removeToken(for: "shared-chan") }

        try await app.addExistingChannel(channelId: "shared-chan", token: "isk_good")

        XCTAssertEqual(app.credentials.map(\.channelId), ["shared-chan"])
        XCTAssertEqual(app.token(for: "shared-chan"), "isk_good")
    }

    /// The live `/c/:id/state` nests the scene under `scene.spec` — the deck
    /// showed "—" for every playing channel until this shape decoded.
    func testChannelStateDecodesNestedSceneSpec() throws {
        let json = #"{"sleeping":false,"scene":{"spec":{"id":"warp","label":"Warp"}}}"#
        let state = try JSONDecoder().decode(ChannelState.self, from: Data(json.utf8))
        XCTAssertEqual(state.scene?.id, "warp")
        XCTAssertEqual(state.scene?.label, "Warp")
    }

    // MARK: - Sync follow

    /// Greptile on #322: A sent, swipe to B and back to A inside the 450 ms
    /// settle, and the screens got B while the phone showed A.
    func testSyncDropsASwipeAbandonedBeforeItSettles() {
        let app = makeApp { _ in (Data(), 404) }
        let a = SyncTarget(channelId: "a", sceneId: nil)
        app.syncTargets = ["screen-1"]
        app.lastSynced = a

        app.syncFollow(channelId: "b", sceneId: nil)
        let pendingB = app.syncTask
        XCTAssertEqual(app.pendingSync, SyncTarget(channelId: "b", sceneId: nil))

        app.syncFollow(channelId: "a", sceneId: nil)
        XCTAssertEqual(pendingB?.isCancelled, true, "the send for B never goes out")
        XCTAssertNil(app.pendingSync)
        XCTAssertNil(app.syncTask)
        XCTAssertEqual(app.lastSynced, a)
    }

    /// A send already under way is the one for this target: landing on it
    /// again must not abort it.
    func testSyncLeavesASendUnderWayAlone() {
        let app = makeApp { _ in (Data(), 404) }
        app.syncTargets = ["screen-1"]
        app.lastSynced = SyncTarget(channelId: "a", sceneId: nil)
        let underWay = Task<Void, Never> { try? await Task.sleep(for: .seconds(5)) }
        defer { underWay.cancel() }
        app.syncTask = underWay   // committed: pendingSync is already nil

        app.syncFollow(channelId: "a", sceneId: nil)
        XCTAssertFalse(underWay.isCancelled)
    }
}

/// Adding a key when one is already held: the `/verify` answers that decide
/// whether it replaces the held one.
@MainActor
final class AddKeyReplacementTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!
    private let suiteName = "IdleScreensTests.AddKeyReplacement"
    private var defaults: UserDefaults!
    private let channelId = "replace-chan"
    private let held = "isk_edit_0123456789abcdef0123456789abcdef"
    private let offered = "isk_view_0123456789abcdef0123456789abcdef"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    /// An app holding an editor key for the channel; `/verify` answers per token.
    private func makeApp(verify: @escaping @Sendable (String) -> (String, Int)) -> AppState {
        let transport = MockTransport()
        transport.handler = { request in
            guard request.url?.path.hasSuffix("/verify") == true,
                  let body = request.httpBody,
                  let object = try? JSONSerialization.jsonObject(with: body) as? [String: String],
                  let token = object["token"] else { return (Data(), 404) }
            let (json, status) = verify(token)
            return (Data(json.utf8), status)
        }
        let store = CredentialStore(userDefaults: defaults)
        store.setToken(held, for: channelId)
        store.save([ChannelCredential(channelId: channelId, label: channelId, createdAt: Date(), role: .editor)])
        return AppState(mcp: MCPClient(baseURL: baseURL, transport: transport),
                        gallery: GalleryClient(baseURL: baseURL, transport: transport),
                        store: store)
    }

    func testALesserKeyNeverDemotesAWorkingOne() async {
        let held = self.held
        let app = makeApp { token in
            token == held ? (#"{"valid":true,"role":"editor","access":"public"}"#, 200)
                          : (#"{"valid":true,"role":"viewer","access":"public"}"#, 200)
        }
        defer { app.store.removeToken(for: channelId) }
        do {
            try await app.addExistingChannel(channelId: channelId, token: offered)
            XCTFail("expected lesserKey")
        } catch {
            guard case VJError.lesserKey = error else { return XCTFail("wrong error: \(error)") }
        }
        XCTAssertEqual(app.token(for: channelId), held)
    }

    func testAWorkingLesserKeyReplacesARefusedOne() async throws {
        let held = self.held
        let app = makeApp { token in
            token == held ? (#"{"valid":false,"role":null,"access":"public"}"#, 200)
                          : (#"{"valid":true,"role":"viewer","access":"public"}"#, 200)
        }
        defer { app.store.removeToken(for: channelId) }
        try await app.addExistingChannel(channelId: channelId, token: offered)
        XCTAssertEqual(app.token(for: channelId), offered)
        XCTAssertEqual(app.credentials.first?.role, .viewer)
    }

    /// A server that could not answer has not declined the key: an error,
    /// and nothing is stored.
    func testARateLimitedVerifyIsAnErrorNotADecline() async {
        let app = makeApp { _ in (#"{"error":"slow down"}"#, 429) }
        app.store.removeToken(for: channelId)
        app.credentials = []
        do {
            try await app.addExistingChannel(channelId: channelId, token: offered)
            XCTFail("expected httpError")
        } catch {
            guard case GalleryError.httpError(let status, _) = error else { return XCTFail("wrong error: \(error)") }
            XCTAssertEqual(status, 429)
        }
        XCTAssertNil(app.token(for: channelId))
        XCTAssertTrue(app.credentials.isEmpty)
    }
}

/// Holds every request until released, so a test can act mid-read.
private final class GatedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var released = false
    private var arrived = 0

    var arrivedCount: Int { lock.withLock { arrived } }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let go = lock.withLock { () -> Bool in
                arrived += 1
                if released { return true }
                waiting.append(continuation)
                return false
            }
            if go { continuation.resume() }
        }
        let body = #"{"access":"private","sleeping":false,"meta":{"label":"Secret"}}"#
        return (Data(body.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }

    func release() {
        let parked = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
            released = true
            defer { waiting = [] }
            return waiting
        }
        parked.forEach { $0.resume() }
    }
}

@MainActor
final class KeyringRowsTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!
    private let suiteName = "IdleScreensTests.KeyringRows"

    /// A channel taken off the keyring while its `/state` read is in flight
    /// does not come back onto the wall when the read lands.
    func testAChannelRemovedMidReadStaysOff() async throws {
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let transport = GatedTransport()
        let store = CredentialStore(userDefaults: defaults)
        let credential = ChannelCredential(channelId: "secret-mid", label: "Secret", createdAt: Date(), role: .viewer)
        store.save([credential])
        let app = AppState(mcp: MCPClient(baseURL: baseURL, transport: transport),
                           gallery: GalleryClient(baseURL: baseURL, transport: transport),
                           store: store)
        defer { app.store.removeToken(for: "secret-mid") }

        let read = Task { await app.keyringPrivateChannels(missingFrom: []) }
        var waited = 0
        while transport.arrivedCount == 0, waited < 200 {
            try await Task.sleep(for: .milliseconds(10))
            waited += 1
        }
        XCTAssertEqual(transport.arrivedCount, 1, "the read is in flight")
        app.removeChannel(credential)
        transport.release()
        let rows = await read.value
        XCTAssertTrue(rows.isEmpty)
    }
}

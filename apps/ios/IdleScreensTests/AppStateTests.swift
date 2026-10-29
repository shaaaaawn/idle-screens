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

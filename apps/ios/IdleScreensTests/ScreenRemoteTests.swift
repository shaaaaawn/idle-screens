import XCTest
@testable import IdleScreens

/// The widgets' and Control Center's send path: what it sends, to whom, what
/// it reports, and which channels it hands back to the app.
final class ScreenRemoteTests: XCTestCase {
    private func snapshot(screens: [String] = ["tv-1", "mac-2"]) -> RemoteSnapshot {
        RemoteSnapshot(
            baseURL: "https://example.com",
            screens: screens.map { .init(deviceId: $0, label: $0.hasPrefix("mac-") ? "Mac" : "Apple TV",
                                         icon: "tv", channelId: "aurora") },
            channels: [
                .init(id: "aurora", label: "Aurora", isPrivate: false),
                .init(id: "secret", label: "Secret", isPrivate: true),
                .init(id: "koi", label: "Koi pond", isPrivate: false),
            ],
            writtenAt: Date())
    }

    // MARK: Sending

    func testSendsToEveryScreenAndSortsOutWhoAnswered() async throws {
        let transport = LockedTransport()
        transport.handler = { request in
            let auth = request.value(forHTTPHeaderField: "Authorization")
            return auth == "Bearer isp_tv" ? (Data(#"{"ok":true,"delivered":1}"#.utf8), 200)
                : (Data(#"{"error":"nobody home"}"#.utf8), 409)
        }
        let remote = ScreenRemote(transport: transport) { ["tv-1": "isp_tv", "mac-2": "isp_mac"][$0] }
        let outcome = await remote.send(.init(id: "koi", label: "Koi pond", isPrivate: false), to: nil, in: snapshot())

        XCTAssertEqual(outcome.delivered, ["tv-1"])
        XCTAssertEqual(outcome.unanswered, ["mac-2"])
        XCTAssertEqual(outcome.asked, 2)
        XCTAssertEqual(outcome.message, "On 1 of 2 screens")
        XCTAssertEqual(transport.requests.count, 2)
        let body = try XCTUnwrap(transport.requests.first?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["channelId"] as? String, "koi")
        XCTAssertNil(json["sealedKey"], "the widget never sends a key")
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/pair/push")
    }

    func testSendsToTheOneScreenAsked() async {
        let transport = LockedTransport()
        transport.handler = { _ in (Data(#"{"ok":true,"delivered":1}"#.utf8), 200) }
        let remote = ScreenRemote(transport: transport) { _ in "isp_x" }
        let outcome = await remote.send(.init(id: "koi", label: "Koi pond", isPrivate: false), to: "mac-2", in: snapshot())
        XCTAssertEqual(outcome.delivered, ["mac-2"])
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(outcome.message, "On your screen")
    }

    func testAScreenWithoutAKeyIsAMissNotACrash() async {
        let transport = LockedTransport()
        let remote = ScreenRemote(transport: transport) { _ in nil }
        let outcome = await remote.send(.init(id: "koi", label: "Koi pond", isPrivate: false), to: nil, in: snapshot())
        XCTAssertTrue(outcome.delivered.isEmpty)
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertEqual(outcome.message, "Couldn't reach your screens")
    }

    // MARK: Snapshot

    func testASendMovesTheScreensThatTookIt() {
        var snap = snapshot()
        snap.record(SendOutcome(channelId: "koi", channelLabel: "Koi pond", delivered: ["mac-2"], asked: 2,
                                unanswered: ["tv-1"], at: Date()))
        XCTAssertEqual(snap.screens.first { $0.deviceId == "mac-2" }?.channelId, "koi")
        XCTAssertEqual(snap.screens.first { $0.deviceId == "tv-1" }?.channelId, "aurora", "a screen that missed it keeps its channel")
        XCTAssertEqual(snap.label(of: "koi"), "Koi pond")
        XCTAssertEqual(snap.lastSend?.message, "On 1 of 2 screens")
    }

    func testTilesKeepTheirOrderAfterASend() {
        var snap = snapshot()
        let before = snap.quickChannels.map(\.id)
        snap.record(SendOutcome(channelId: "koi", channelLabel: "Koi pond", delivered: ["tv-1"], asked: 1,
                                unanswered: [], at: Date()))
        XCTAssertEqual(snap.quickChannels.map(\.id), before)
    }

    func testOutcomeWording() {
        func outcome(_ delivered: [String], asked: Int, unanswered: [String] = []) -> String {
            SendOutcome(channelId: "c", channelLabel: "C", delivered: delivered, asked: asked,
                        unanswered: unanswered, at: Date()).message
        }
        XCTAssertEqual(outcome([], asked: 0), "No screens paired")
        XCTAssertEqual(outcome(["a"], asked: 1), "On your screen")
        XCTAssertEqual(outcome(["a", "b"], asked: 2), "On 2 screens")
        XCTAssertEqual(outcome([], asked: 2, unanswered: ["a", "b"]), "Screens aren't answering")
        XCTAssertEqual(outcome([], asked: 2), "Couldn't reach your screens")
    }

    // MARK: Next channel

    func testNextSkipsPrivateAndWraps() {
        var snap = snapshot()
        XCTAssertEqual(SendChannelIntent.next(in: snap, screen: nil)?.id, "koi", "after aurora, past the private one")
        for i in snap.screens.indices { snap.screens[i].channelId = "koi" }
        XCTAssertEqual(SendChannelIntent.next(in: snap, screen: nil)?.id, "aurora", "wraps to the top")
        for i in snap.screens.indices { snap.screens[i].channelId = "elsewhere" }
        XCTAssertEqual(SendChannelIntent.next(in: snap, screen: nil)?.id, "aurora", "a channel off the list starts at the top")
    }

    // MARK: Handing private channels to the app

    func testAppLinkRoundTrips() throws {
        let url = try XCTUnwrap(ScreenRemote.appLink(channelId: "secret", screenId: "tv-1"))
        XCTAssertEqual(url.absoluteString, "idlescreens://send/secret?screen=tv-1")
        let parsed = try XCTUnwrap(ScreenRemote.parseAppLink(url))
        XCTAssertEqual(parsed.channelId, "secret")
        XCTAssertEqual(parsed.screenId, "tv-1")
        XCTAssertNil(ScreenRemote.parseAppLink(URL(string: "idlescreens://pair/ABC123")!))
        XCTAssertNil(ScreenRemote.parseAppLink(URL(string: "idlescreens://send/")!))
    }

    func testWhichChannelsTheAppMustSend() {
        XCTAssertTrue(AppState.needsAppToSend(access: "private", holdsKey: true))
        XCTAssertTrue(AppState.needsAppToSend(access: "private", holdsKey: false))
        XCTAssertFalse(AppState.needsAppToSend(access: "public", holdsKey: true))
        XCTAssertFalse(AppState.needsAppToSend(access: nil, holdsKey: false), "a follow of a channel off the wall")
        XCTAssertTrue(AppState.needsAppToSend(access: nil, holdsKey: true), "unknown and keyed: it may be private")
    }

    @MainActor func testThePairTokenKeyIsSharedWithTheApp() {
        XCTAssertEqual(ScreenRemote.tokenKey(for: "abc"), AppState.pairTokenKey(for: "abc"))
    }
}

/// MockTransport for concurrent sends: ScreenRemote pushes to every screen at
/// once, and an unlocked request log would race.
private final class LockedTransport: HTTPTransport, @unchecked Sendable {
    var handler: @Sendable (URLRequest) -> (Data, Int) = { _ in (Data(), 200) }
    private let lock = NSLock()
    private var log: [URLRequest] = []

    var requests: [URLRequest] { lock.withLock { log } }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { log.append(request) }
        let (data, status) = handler(request)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

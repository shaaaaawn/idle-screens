import XCTest
@testable import IdleScreens

/// The wall reads `GET /api/channels?slim=1` and fetches each channel's scene
/// from `/c/:id/state` when a tile shows it. These pin both halves against
/// payloads captured from prod on 2026-11-16 (Fixtures/: trimmed to the keys
/// the decoder reads, `lastEvent.intent` blanked, the Screen Test reels left
/// out), and hold the poster a tile draws to the one the full listing gave.
final class SlimListingDecodeTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"),
                                "missing fixture \(name).json")
        return try Data(contentsOf: url)
    }

    private func fullRow(_ id: String) throws -> PublicChannel {
        let rows = try JSONDecoder().decode([PublicChannel].self, from: fixture("channels-full-rows-2026-11-16"))
        return try XCTUnwrap(rows.first { $0.id == id })
    }

    private func slimRow(_ id: String) throws -> PublicChannel {
        let rows = try JSONDecoder().decode([PublicChannel].self, from: fixture("channels-slim-2026-11-16"))
        return try XCTUnwrap(rows.first { $0.id == id })
    }

    /// What `GalleryClient.fetchDetail` makes of a `/state` body.
    private func detail(fromState id: String) throws -> (ChannelDetail, reducedBytes: Data, stateBytes: Data) {
        let state = try fixture("state-\(id)-2026-11-16")
        let reduced = try XCTUnwrap(ChannelDetail.Reduced.from(state))
        let bytes = try XCTUnwrap(reduced.bytes)
        return (try XCTUnwrap(ChannelDetail(reduced: bytes)), bytes, state)
    }

    // MARK: The slim payload

    func testTheCapturedSlimPayloadDecodesEveryRowWithoutAScene() throws {
        let rows = try JSONDecoder().decode([PublicChannel].self, from: fixture("channels-slim-2026-11-16"))
        // Every listed channel on 2026-11-16 but the Screen Test reels, with
        // each `lastEvent.intent` blanked and only the keys the decoder reads.
        XCTAssertEqual(rows.count, 47)
        XCTAssertEqual(Set(rows.map(\.id)).count, 47, "ids are unique")
        for row in rows {
            XCTAssertFalse(row.detailLoaded, "\(row.id): the slim row carries no scene")
            XCTAssertNil(row.spec)
            XCTAssertNil(row.rawSpec)
            XCTAssertNil(row.classicSaverId)
            XCTAssertNotNil(row.label, row.id)
            XCTAssertNotNil(row.lastEventAt, "\(row.id): the freshness key is in every row")
        }
        // What the tiles and shelves read, all present.
        let fishtank = try XCTUnwrap(rows.first { $0.id == "fishtank" })
        XCTAssertEqual(fishtank.displayLabel, "Fishtank")
        XCTAssertEqual(fishtank.saverLabel, "metaquarium")
        XCTAssertEqual(fishtank.isProtected, true)
        XCTAssertEqual(fishtank.tags?.first, "featured")
        XCTAssertEqual(fishtank.lastSteer?.actor, "Spin")
        let swan = try XCTUnwrap(rows.first { $0.id == "swan-lake" })
        XCTAssertEqual(swan.categoryId, "ballets-of-light")
        XCTAssertEqual(swan.categorySort, 3)
        XCTAssertEqual(swan.saverLabel, "Swan Lake — a triptych")
        // The slim row has no `access` (the listing never holds a private
        // channel), so nil must read as public: nothing is filtered out.
        XCTAssertTrue(rows.allSatisfy { $0.access == nil })
        XCTAssertEqual(ChannelFeed.latestFirst(rows).count, 47)
    }

    func testAFullRowAndAStateAreLoadedAndASlimRowIsNot() throws {
        XCTAssertTrue(try fullRow("lobby").detailLoaded)
        XCTAssertFalse(try slimRow("lobby").detailLoaded)
        // A channel with nothing published: known, and empty.
        let empty = try JSONDecoder().decode(PublicChannel.self,
                                             from: Data(#"{"id":"x","scene":null,"resolvedSpec":null}"#.utf8))
        XCTAssertTrue(empty.detailLoaded)
        XCTAssertNil(empty.spec)
    }

    // MARK: Poster parity with the full listing

    /// A sequence channel: its poster is the first segment, read from the
    /// `/state` exactly as it was from the full listing row (which, since the
    /// server's de-duplication, carries `resolvedSpec` and no `scene.spec`).
    func testASequencePostersTheSameFromItsStateAsFromTheFullListing() throws {
        let full = try fullRow("swan-lake")
        let (fromState, _, _) = try detail(fromState: "swan-lake")
        XCTAssertNotNil(full.spec, "the full listing postered it")
        XCTAssertEqual(fromState.spec, full.spec)
        XCTAssertEqual(fromState.rawSpec, full.rawSpec, "mix republishes this, verbatim")
        XCTAssertNil(fromState.classicSaverId)
        // And it is the sequence's poster segment, not a bare envelope.
        guard case .object(let envelope)? = fromState.rawSpec else { return XCTFail("raw spec is an object") }
        XCTAssertEqual(envelope["format"], .string("idle-sequence"))
        let seq = try JSONDecoder().decode(SequenceSubset.self, from: JSONEncoder().encode(fromState.rawSpec))
        XCTAssertEqual(seq.posterScene, fromState.spec)
        XCTAssertFalse(fromState.spec?.layers.isEmpty ?? true)
    }

    /// A tank: no layers, so the poster is the native port with the look its
    /// track sets. If `classicParams` were lost every tank would poster as
    /// the default reef — the likeliest silent regression here.
    func testATankKeepsItsSaverIdAndItsLookFromItsState() throws {
        let full = try fullRow("reef-at-noon")
        let (fromState, _, _) = try detail(fromState: "reef-at-noon")
        XCTAssertEqual(full.classicSaverId, "metaquarium")
        XCTAssertEqual(fromState.classicSaverId, "metaquarium")
        XCTAssertNil(fromState.spec)
        XCTAssertFalse(fromState.classicParams.isEmpty)
        XCTAssertEqual(fromState.classicParams, full.classicParams)
        XCTAssertEqual(fromState.classicParams["environment"], "reef")
        XCTAssertEqual(fromState.rawSpec, full.rawSpec)
    }

    func testAPlainSceneMatchesToo() throws {
        let full = try fullRow("lobby")
        let (fromState, _, _) = try detail(fromState: "lobby")
        XCTAssertNotNil(full.spec)
        XCTAssertEqual(fromState.spec, full.spec)
        XCTAssertEqual(fromState.rawSpec, full.rawSpec)
        XCTAssertEqual(fromState.classicParams, full.classicParams)
    }

    /// A slim row plus its channel's scene is the row the full listing gave:
    /// the scene half from `/state`, everything else from the listing.
    func testASlimRowWithItsSceneIsTheFullRow() throws {
        for id in ["swan-lake", "reef-at-noon", "lobby"] {
            let full = try fullRow(id)
            let slim = try slimRow(id)
            let merged = slim.with(try detail(fromState: id).0)
            XCTAssertTrue(merged.detailLoaded, id)
            XCTAssertEqual(merged.spec, full.spec, id)
            XCTAssertEqual(merged.rawSpec, full.rawSpec, id)
            XCTAssertEqual(merged.classicSaverId, full.classicSaverId, id)
            XCTAssertEqual(merged.classicParams, full.classicParams, id)
            XCTAssertEqual(merged.label, slim.label, id)
            XCTAssertEqual(merged.lastEventAt, slim.lastEventAt, id)
            XCTAssertEqual(merged.saverLabel, slim.saverLabel, id)
        }
    }

    /// What goes to disk is the scene once and its track: reading it back is
    /// the same detail as decoding the whole `/state`.
    func testTheReducedCopyOnDiskReadsBackAsTheSameScene() throws {
        for id in ["swan-lake", "reef-at-noon", "lobby"] {
            let (fromReduced, bytes, state) = try detail(fromState: id)
            let direct = ChannelDetail(row: try JSONDecoder().decode(PublicChannel.self, from: state))
            XCTAssertEqual(fromReduced, direct, id)
            XCTAssertLessThan(bytes.count, state.count, "\(id): smaller than the /state it came from")
        }
        // A sequence's /state carries its spec twice; the copy keeps one.
        let (_, bytes, state) = try detail(fromState: "swan-lake")
        XCTAssertLessThan(Double(bytes.count), Double(state.count) * 0.6)
    }
}

/// `GalleryClient` against a stub server: the URLs it asks for, the cache it
/// keeps, and the migration of the full-list cache an earlier build wrote.
final class SlimGalleryClientTests: XCTestCase {
    private var baseURL: URL!
    private var cachesDir: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }

    override func setUp() {
        super.setUp()
        // A host of its own, so the on-disk caches (keyed by host) start empty.
        baseURL = URL(string: "https://slim-\(UUID().uuidString.prefix(8).lowercased()).test")!
    }

    override func tearDown() {
        let host = baseURL.host!
        for name in ["channels-slim-v1-\(host).json", "channels-v2-\(host).json", "channels-\(host).json",
                     "channel-details-v1-\(host)"] {
            try? FileManager.default.removeItem(at: cachesDir.appendingPathComponent(name))
        }
        super.tearDown()
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }

    /// Serves the captured slim list and the three captured `/state`s.
    private func server() throws -> MockTransport {
        let slim = try fixture("channels-slim-2026-11-16")
        var states: [String: Data] = [:]
        for id in ["swan-lake", "reef-at-noon", "lobby"] {
            states["/c/\(id)/state"] = try fixture("state-\(id)-2026-11-16")
        }
        let transport = MockTransport()
        transport.handler = { [states] request in
            let path = request.url?.path ?? ""
            if path == "/api/channels" { return (slim, 200) }
            if let body = states[path] { return (body, 200) }
            return (Data(#"{"error":"not found"}"#.utf8), 404)
        }
        return transport
    }

    func testTheListIsFetchedSlimWithAQueryNotAnEncodedPath() async throws {
        let transport = try server()
        let client = GalleryClient(baseURL: baseURL, transport: transport)
        let rows = try await client.fetchChannels()
        XCTAssertEqual(rows.count, 47)
        // The slim row has no `access`; a listed channel is public by the
        // server's contract, and nil would read as "unknown" to a held key.
        XCTAssertTrue(rows.allSatisfy { $0.access == "public" })
        let url = try XCTUnwrap(transport.requests.first?.url)
        XCTAssertEqual(url.path, "/api/channels")
        XCTAssertEqual(url.query, "slim=1")
        XCTAssertFalse(url.absoluteString.contains("%3F"))
        // Cached for the next cold launch, slim.
        XCTAssertEqual(client.cachedChannels()?.count, 47)
        XCTAssertEqual(client.cachedChannels()?.contains { $0.detailLoaded }, false)
        XCTAssertEqual(client.cachedChannels()?.allSatisfy { $0.access == "public" }, true)
    }

    func testADetailIsReadFromStateAndKeptOnDiskForTheNextLaunch() async throws {
        let transport = try server()
        let client = GalleryClient(baseURL: baseURL, transport: transport)
        let detail = try await client.fetchDetail(channelId: "swan-lake")
        XCTAssertEqual(transport.requests.last?.url?.path, "/c/swan-lake/state")
        XCTAssertNotNil(detail.spec)
        // A new client on the same host — a cold launch — has it without asking.
        let cold = GalleryClient(baseURL: baseURL, transport: MockTransport())
        XCTAssertEqual(cold.cachedDetails()["swan-lake"], detail)
    }

    /// The first launch after the update: the full list the old build cached
    /// still paints the wall (scenes inline), and the first slim fetch turns
    /// it into per-channel scenes and deletes it.
    func testTheFullListCacheAnEarlierBuildWroteBecomesPerChannelScenes() async throws {
        let legacy = cachesDir.appendingPathComponent("channels-v2-\(baseURL.host!).json")
        try fixture("channels-full-rows-2026-11-16").write(to: legacy)
        let client = GalleryClient(baseURL: baseURL, transport: try server())
        let painted = try XCTUnwrap(client.cachedChannels())
        XCTAssertEqual(painted.count, 3)
        XCTAssertTrue(painted.allSatisfy(\.detailLoaded), "the old cache still has its posters")

        _ = try await client.fetchChannels()
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path), "migrated, then removed")
        let details = client.cachedDetails()
        XCTAssertEqual(Set(details.keys), ["swan-lake", "reef-at-noon", "lobby"])
        for row in painted {
            XCTAssertEqual(details[row.id], ChannelDetail(row: row), row.id)
        }
    }

    /// A channel that leaves the listing takes its scene off disk.
    func testScenesOfChannelsNoLongerListedArePruned() async throws {
        let transport = try server()
        let client = GalleryClient(baseURL: baseURL, transport: transport)
        _ = try await client.fetchDetail(channelId: "lobby")
        let slim = try fixture("channels-slim-2026-11-16")
        let withoutLobby = try JSONSerialization.data(withJSONObject:
            (try JSONSerialization.jsonObject(with: slim) as! [[String: Any]]).filter { $0["id"] as? String != "lobby" })
        transport.handler = { _ in (withoutLobby, 200) }
        _ = try await client.fetchChannels()
        XCTAssertNil(client.cachedDetails()["lobby"])
    }
}

/// `ChannelDetails`: what is fetched, when, and how it reaches the wall.
@MainActor
final class ChannelDetailsTests: XCTestCase {
    private var baseURL: URL!

    override func setUp() {
        super.setUp()
        baseURL = URL(string: "https://details-\(UUID().uuidString.prefix(8).lowercased()).test")!
    }

    override func tearDown() {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("channel-details-v1-\(baseURL.host!)"))
        super.tearDown()
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }

    private func slimRows() throws -> [PublicChannel] {
        try JSONDecoder().decode([PublicChannel].self, from: fixture("channels-slim-2026-11-16"))
    }

    private func states() throws -> [String: Data] {
        var out: [String: Data] = [:]
        for id in ["swan-lake", "reef-at-noon", "lobby"] {
            out["/c/\(id)/state"] = try fixture("state-\(id)-2026-11-16")
        }
        return out
    }

    /// Waits for `onArrive` to have delivered `count` channels.
    private func arrivals(_ details: ChannelDetails, count: Int) async -> [String: ChannelDetail] {
        var got: [String: ChannelDetail] = [:]
        details.onArrive = { got.merge($0) { $1 } }
        for _ in 0..<300 where got.count < count {
            try? await Task.sleep(for: .milliseconds(10))
        }
        return got
    }

    func testAWantedTileGetsItsSceneInOneBatchAndIsNotFetchedTwice() async throws {
        let transport = MockTransport()
        let states = try states()
        transport.handler = { request in
            let body = states[request.url?.path ?? ""]
            return (body ?? Data("{}".utf8), body == nil ? 404 : 200)
        }
        let details = ChannelDetails(gallery: GalleryClient(baseURL: baseURL, transport: transport))
        let rows = try slimRows()
        let wanted = rows.filter { ["swan-lake", "reef-at-noon", "lobby"].contains($0.id) }
        let got = Task { await arrivals(details, count: 3) }
        for row in wanted { details.want(row) }
        let batch = await got.value
        XCTAssertEqual(Set(batch.keys), ["swan-lake", "reef-at-noon", "lobby"])

        // Applied to the slim rows: posters, and nothing else changed.
        let applied = details.apply(to: rows)
        XCTAssertEqual(applied.filter(\.detailLoaded).map(\.id).sorted(), ["lobby", "reef-at-noon", "swan-lake"])
        XCTAssertEqual(applied.map(\.id), rows.map(\.id))

        // The same rows again (a redraw, a return to the shelf): nothing to fetch.
        let before = transport.requests.count
        for row in wanted { details.want(row) }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(transport.requests.count, before)
    }

    /// The listing says the channel changed since: the scene is fetched again.
    func testANewerListingRowRefetchesTheScene() async throws {
        let transport = MockTransport()
        let states = try states()
        transport.handler = { request in (states[request.url?.path ?? ""] ?? Data(), 200) }
        let details = ChannelDetails(gallery: GalleryClient(baseURL: baseURL, transport: transport))
        let lobby = try XCTUnwrap(try slimRows().first { $0.id == "lobby" })
        let first = Task { await arrivals(details, count: 1) }
        details.want(lobby)
        _ = await first.value
        XCTAssertTrue(details.isFresh("lobby", lastEventAt: lobby.lastEventAt))

        let steered = PublicChannel(channelId: "lobby", label: "lobby", tags: nil, viewers: nil,
                                    lastEventAt: (lobby.lastEventAt ?? 0) + 1, detailLoaded: false)
        XCTAssertFalse(details.isFresh("lobby", lastEventAt: steered.lastEventAt))
        let before = transport.requests.count
        let second = Task { await arrivals(details, count: 1) }
        details.want(steered)
        _ = await second.value
        XCTAssertEqual(transport.requests.count, before + 1)
    }

    /// A failed read is not retried on every redraw of the tile.
    func testAFailedReadWaitsBeforeTryingAgain() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Data("oops".utf8), 500) }
        let details = ChannelDetails(gallery: GalleryClient(baseURL: baseURL, transport: transport))
        let row = PublicChannel(channelId: "down", label: nil, tags: nil, viewers: nil, lastEventAt: 1)
        details.want(row)
        try await Task.sleep(for: .milliseconds(150))
        details.want(row)
        details.want(row)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(transport.requests.count, 1)
    }

    /// Rows decoded whole (a private channel's `/state`, the old full-list
    /// cache) teach the store their scenes; the slim rows that replace them
    /// keep the posters.
    func testAbsorbedRowsKeepTheirScenesAcrossASlimRefresh() throws {
        let details = ChannelDetails(gallery: GalleryClient(baseURL: baseURL, transport: MockTransport()))
        let full = try JSONDecoder().decode([PublicChannel].self, from: fixture("channels-full-rows-2026-11-16"))
        details.absorb(full)
        let slim = try slimRows().filter { row in full.contains { $0.id == row.id } }
        let applied = details.apply(to: slim)
        for row in applied {
            let was = try XCTUnwrap(full.first { $0.id == row.id })
            XCTAssertTrue(row.detailLoaded, row.id)
            XCTAssertEqual(row.spec, was.spec, row.id)
            XCTAssertEqual(row.classicParams, was.classicParams, row.id)
            XCTAssertTrue(details.isFresh(row.id, lastEventAt: row.lastEventAt), row.id)
        }
    }
}

/// The app: the wall fills in as scenes land, and a mix republishes the
/// source's scene as `/state` has it at the tap.
@MainActor
final class SlimWallAppStateTests: XCTestCase {
    private let suiteName = "IdleScreensTests.SlimWall"
    private var baseURL: URL!

    override func setUp() {
        super.setUp()
        baseURL = URL(string: "https://wall-\(UUID().uuidString.prefix(8).lowercased()).test")!
    }

    override func tearDown() {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host!
        for name in ["channels-slim-v1-\(host).json", "categories-\(host).json", "channel-details-v1-\(host)"] {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
        }
        UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }

    private func makeApp(_ transport: MockTransport) -> AppState {
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return AppState(mcp: MCPClient(baseURL: baseURL, transport: transport),
                        gallery: GalleryClient(baseURL: baseURL, transport: transport),
                        store: CredentialStore(userDefaults: defaults))
    }

    private func serve(_ transport: MockTransport, published: @escaping @Sendable (Data) -> Void = { _ in }) throws {
        let slim = try fixture("channels-slim-2026-11-16")
        let swan = try fixture("state-swan-lake-2026-11-16")
        transport.handler = { request in
            switch request.url?.path ?? "" {
            case "/api/channels": return (slim, 200)
            case "/c/swan-lake/state": return (swan, 200)
            case "/mcp":
                published(request.httpBody ?? Data())
                return (MockTransport.mcpEnvelope(resultText: #"{"ok":true}"#), 200)
            default: return (Data(), 404)
            }
        }
    }

    func testTheWallLoadsSlimAndATileFillsInItsScene() async throws {
        let transport = MockTransport()
        try serve(transport)
        let app = makeApp(transport)
        await app.loadGallery()
        XCTAssertEqual(app.channels.count, 47)
        XCTAssertFalse(app.channels.contains { $0.detailLoaded }, "the list alone carries no scene")
        // A listed channel you hold a key for is sent by the widget itself,
        // as it was with the full list: the slim row is public, not unknown.
        let listed = try XCTUnwrap(app.channels.first { $0.id == "lobby" })
        XCTAssertFalse(AppState.needsAppToSend(access: listed.access, holdsKey: true))

        let swan = try XCTUnwrap(app.channels.first { $0.id == "swan-lake" })
        app.wantDetail(swan)
        for _ in 0..<300 where app.channels.first(where: { $0.id == "swan-lake" })?.spec == nil {
            try await Task.sleep(for: .milliseconds(10))
        }
        let filled = try XCTUnwrap(app.channels.first { $0.id == "swan-lake" })
        XCTAssertNotNil(filled.spec)
        XCTAssertEqual(filled.label, swan.label)
        // A feed holding the copy it was opened with still reaches the scene.
        XCTAssertNotNil(app.current(swan).spec)
    }

    func testAMixFetchesTheSourceSceneAtTheTapAndPublishesItVerbatim() async throws {
        let transport = MockTransport()
        let sent = Box()
        try serve(transport) { sent.set($0) }
        let app = makeApp(transport)
        await app.loadGallery()
        XCTAssertNil(app.channels.first { $0.id == "swan-lake" }?.rawSpec, "never shown, so never fetched")
        _ = app.store.setToken("isk_0123456789abcdef0123456789abcdef", for: "mine")
        defer { app.store.removeToken(for: "mine") }

        try await app.adoptScene(from: "swan-lake", into: "mine")

        XCTAssertTrue(transport.requests.contains { $0.url?.path == "/c/swan-lake/state" })
        let body = try XCTUnwrap(sent.value)
        let call = try JSONDecoder().decode(JSONValue.self, from: body)
        guard case .object(let root) = call, case .object(let params)? = root["params"],
              case .object(let args)? = params["arguments"] else { return XCTFail("tools/call shape") }
        let state = try JSONDecoder().decode(PublicChannel.self, from: fixture("state-swan-lake-2026-11-16"))
        XCTAssertEqual(args["spec"], state.rawSpec, "the source's spec as /state has it, untouched")
    }
}

private final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    var value: Data? { lock.withLock { data } }
    func set(_ new: Data) { lock.withLock { data = new } }
}

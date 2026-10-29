import XCTest
@testable import IdleScreens

/// App Review guideline 1.2 surfaces: posters for the curated tanks, the
/// Report request, and Hide.
@MainActor
final class ContentReportTests: XCTestCase {

    // MARK: Classic posters

    /// A prod row verbatim (2026-10-26): the resolved spec is the bare saver
    /// ref, and the tank's look lives only in the scene's track. Reading
    /// `rawSpec.params` (the old path) found nothing, so every tank was
    /// the default reef — and the grid never asked for a tank at all.
    private let pyramidsRow = #"""
    {"id": "pyramids", "label": "Pyramids", "tags": ["metaquarium", "pyramids", "light-show", "showcase", "aquarium"], "resolvedSpec": {"id": "metaquarium"}, "scene": {"spec": {"id": "metaquarium"}, "seed": 21, "track": {"deltas": [{"t": 0, "path": "environment", "value": "abyss", "ease": "step"}, {"t": 0, "path": "pyramids", "value": 1, "ease": "step"}, {"t": 0, "path": "pyramidMix", "value": "giza:2,frame,step,mayan,obsidian:3,crystal:2,gold:0.5", "ease": "step"}, {"t": 0, "path": "fishMix", "value": "7,23,42,88,130,201", "ease": "step"}, {"t": 0, "path": "fishGlow", "value": 0.8, "ease": "step"}, {"t": 0, "path": "floorKind", "value": "flat", "ease": "step"}, {"t": 0, "path": "autoRotate", "value": 1.5, "ease": "step"}, {"t": 0, "path": "fogFar", "value": 1000, "ease": "step"}, {"t": 0, "path": "cameraElevation", "value": 24, "ease": "step"}]}, "schemaAt": "3.12.1"}, "protected": true, "saver": "metaquarium"}
    """#

    func testMetaquariumRowCarriesItsSaverAndLook() throws {
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(pyramidsRow.utf8))
        XCTAssertNil(channel.spec)
        XCTAssertEqual(channel.classicSaverId, "metaquarium")
        XCTAssertEqual(channel.classicParams["environment"], "abyss")
        XCTAssertEqual(channel.classicParams["fishMix"], "7,23,42,88,130,201")
        XCTAssertEqual(channel.classicParams["pyramids"], "1")
        XCTAssertEqual(channel.classicParams["fishGlow"], "0.8")
    }

    func testSchemaChannelsSkipTheTrackRead() throws {
        let json = #"{"id":"aurora","resolvedSpec":{"schemaVersion":1,"id":"aurora","layers":[]},"scene":{"track":{"deltas":[{"t":0,"path":"environment","value":"reef"}]}}}"#
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(json.utf8))
        XCTAssertNil(channel.classicSaverId)
        XCTAssertEqual(channel.classicParams, [:])
    }

    // MARK: Report

    func testReportArgumentsAreOnlyAppWrittenWords() {
        let args = ContentReport.arguments(channelId: "pyramids", label: "Pyramids",
                                           reason: .infringement, surface: "iPhone")
        XCTAssertEqual(args["kind"], .string("other"))
        XCTAssertEqual(args["channelId"], .string("pyramids"))
        XCTAssertEqual(args["title"], .string("Content report: pyramids (infringement)"))
        guard case .string(let body)? = args["body"] else { return XCTFail("no body") }
        XCTAssertTrue(body.contains(#""Pyramids" (pyramids)"#), body)
        XCTAssertTrue(body.contains("Reason: Uses someone else's work or brand."), body)
        XCTAssertTrue(body.contains("iPhone app"), body)
        XCTAssertEqual(Set(args.keys), ["kind", "title", "body", "channelId"])
    }

    /// The server caps title at 120 and channelId at 64; the longest id plus
    /// the longest reason must still fit.
    func testReportTitleFitsTheServerCap() {
        let id = String(repeating: "x", count: 64)
        for reason in ContentReport.Reason.allCases {
            guard case .string(let title)? = ContentReport.arguments(
                channelId: id, label: nil, reason: reason, surface: "Apple TV")["title"] else {
                return XCTFail("no title")
            }
            XCTAssertLessThanOrEqual(title.count, 120, title)
        }
    }

    func testReportChannelSendsSubmitFeedbackAttributed() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (MockTransport.mcpEnvelope(resultText: #"{"id":"X1"}"#), 200) }
        let client = MCPClient(baseURL: URL(string: "https://example.com")!, transport: transport)
        try await client.reportChannel(channelId: "fishtank", label: "Fishtank", reason: .sexual)

        let request = try XCTUnwrap(transport.requests.first)
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
        let params = body?["params"] as? [String: Any]
        XCTAssertEqual(params?["name"] as? String, "submitFeedback")
        let args = try XCTUnwrap(params?["arguments"] as? [String: Any])
        XCTAssertEqual(args["channelId"] as? String, "fishtank")
        XCTAssertEqual(args["kind"] as? String, "other")
        XCTAssertEqual(args["harness"] as? String, "idlescreens-ios")
        XCTAssertFalse((args["intent"] as? String ?? "").isEmpty)
        XCTAssertNil(args["agent"], "no AI acts here")
    }

    func testRefusedReportThrows() async {
        let transport = MockTransport()
        transport.handler = { _ in
            (MockTransport.mcpEnvelope(resultText: #"{"error":"The feedback queue is full"}"#, isError: true), 200)
        }
        let client = MCPClient(baseURL: URL(string: "https://example.com")!, transport: transport)
        do {
            try await client.reportChannel(channelId: "fishtank", label: nil, reason: .other)
            XCTFail("a refused report must not read as sent")
        } catch {}
    }

    // MARK: Hide

    func testHiddenChannelsFilterAndPersist() {
        final class Box: @unchecked Sendable { var saved: [String]? }
        let box = Box()
        let storage = HiddenChannels.Storage(load: { box.saved }, save: { box.saved = $0 })
        let hidden = HiddenChannels(storage: storage)
        let wall = ["a", "b", "c"].map { PublicChannel(channelId: $0, label: nil, tags: nil, viewers: nil) }

        hidden.hide("b")
        hidden.hide("b")
        XCTAssertEqual(hidden.visible(wall).map(\.id), ["a", "c"])
        XCTAssertEqual(box.saved, ["b"])

        let relaunched = HiddenChannels(storage: storage)
        XCTAssertTrue(relaunched.isHidden("b"))
        relaunched.unhide("b")
        XCTAssertEqual(relaunched.visible(wall).map(\.id), ["a", "b", "c"])
        XCTAssertEqual(box.saved, [])
    }

    /// Hiding the page on screen lands on the next one, else the one before,
    /// else nowhere (the shelf closes).
    func testFeedMovesOnFromAHiddenPage() {
        let order = ["a", "b", "c", "d"]
        XCTAssertEqual(FeedOrder.successor(of: "b", in: order, among: ["a", "c", "d"]), "c")
        XCTAssertEqual(FeedOrder.successor(of: "d", in: order, among: ["a", "b", "c"]), "c")
        XCTAssertEqual(FeedOrder.successor(of: "b", in: order, among: ["a", "d"]), "d")
        XCTAssertNil(FeedOrder.successor(of: "a", in: ["a"], among: []))
    }
}

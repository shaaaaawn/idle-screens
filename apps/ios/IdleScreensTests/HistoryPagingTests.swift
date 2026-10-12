import XCTest
@testable import IdleScreens

final class HistoryPagingTests: XCTestCase {
    private func event(_ id: Int, scene: Int?) -> ChannelEvent {
        ChannelEvent(id: id, at: Double(id) * 1000, kind: "publish", sceneId: scene)
    }

    /// Paged history must not be capped: the strip grows as you swipe.
    func testUncappedStopsKeepEveryDistinctPastScene() {
        let events = (1...60).map { event($0, scene: $0) }
        XCTAssertEqual(ChannelFeed.stops(from: events).count, 24, "the single-fetch default is still capped")
        XCTAssertEqual(ChannelFeed.stops(from: events, limit: nil).count, 59, "live scene excluded, the rest kept")
    }

    func testAppendingAnOlderPageExtendsTheStripWithoutDuplicates() {
        let first = (41...60).map { event($0, scene: $0) }
        let older = (21...45).map { event($0, scene: $0) }      // overlaps 41…45
        let stops = ChannelFeed.stops(from: first + older, limit: nil)
        XCTAssertEqual(stops.count, Set(stops.map(\.sceneId)).count)
        XCTAssertEqual(stops.first?.sceneId, 59)
        XCTAssertEqual(stops.last?.sceneId, 21)
    }

    func testSegmentWindowSlidesWithYou() {
        XCTAssertEqual(ChannelFeed.segmentWindow(count: 8, here: 3, size: 20), Array(0..<8))
        let start = ChannelFeed.segmentWindow(count: 200, here: 0, size: 20)
        XCTAssertEqual(start.first, 0); XCTAssertEqual(start.count, 20)
        let mid = ChannelFeed.segmentWindow(count: 200, here: 100, size: 20)
        XCTAssertEqual(mid.first, 95); XCTAssertTrue(mid.contains(100))
        let end = ChannelFeed.segmentWindow(count: 200, here: 199, size: 20)
        XCTAssertEqual(end.last, 199); XCTAssertEqual(end.count, 20)
    }
}

final class MCPCatalogTests: XCTestCase {
    private func tool(_ name: String, _ description: String? = nil) -> MCPCatalog.Tool {
        try! JSONDecoder().decode(MCPCatalog.Tool.self, from: Data(#"{"name":"\#(name)","description":\#(description.map { "\"\($0)\"" } ?? "null")}"#.utf8))
    }

    func testToolsGroupByPurposeAndUnknownOnesLandInMore() {
        let groups = MCPCatalog.grouped([tool("setParam"), tool("createChannel"), tool("submitFeedback"), tool("brandNewTool")])
        XCTAssertEqual(groups.map(\.title), ["Make", "Steer", "Feedback", "More"])
        XCTAssertEqual(groups.last?.tools.map(\.name), ["brandNewTool"])
    }

    func testSummaryIsTheFirstSentence() {
        XCTAssertEqual(tool("x", "Publish a scene to a channel. Every viewer watching renders it.").summary,
                       "Publish a scene to a channel.")
        XCTAssertEqual(tool("y", "No full stop here").summary, "No full stop here")
        // A dot inside a word (screen://schema, 0.5) is not a sentence end.
        XCTAssertEqual(tool("z", "Read screen://schema first. Then go.").summary, "Read screen://schema first.")
    }

    func testFeedbackDecodesTheServersShape() throws {
        let json = #"{"note":"…","findings":[{"id":"F7","title":"t","status":"open"}],"submissions":[{"id":"X1","title":"s","kind":"docs","severity":"minor","status":"open","votes":2,"hits":3}],"findingsAsOf":"2026-10-01"}"#
        let feedback = try JSONDecoder().decode(MCPCatalog.Feedback.self, from: Data(json.utf8))
        XCTAssertEqual(feedback.findings.first?.id, "F7")
        XCTAssertEqual(feedback.submissions?.first?.votes, 2)
    }
}

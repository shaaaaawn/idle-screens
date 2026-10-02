import XCTest
@testable import IdleScreens

/// What the native renderer can draw faithfully. Wrong in one direction, a
/// timed piece shows as a dark still (logo's "deep-seek"); wrong in the other,
/// every history page pays for a WebView and a live-page reload.
final class NativeSupportTests: XCTestCase {
    private func json(_ s: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(s.utf8))
    }
    private func scene(_ s: String) throws -> RecordedScene {
        try JSONDecoder().decode(RecordedScene.self, from: Data(s.utf8))
    }

    private let layer = #"{"key":"a","count":1,"sprite":{"kind":"circle"},"motion":{"type":"static"}}"#

    func testAPlainLayoutSceneIsFaithful() throws {
        // Signal Board's shape: table layout, text, a drifting stroke. Native
        // matched the site pixel for pixel — it must stay native.
        let spec = try json("""
        {"schemaVersion":1,"id":"sb","label":"Signal Board","layers":[
          {"key":"readout","count":9,"sprite":{"kind":"bar"},"layout":{"type":"table","columns":3},"motion":{"type":"static"}},
          {"key":"labels","count":9,"sprite":{"kind":"text"},"motion":{"type":"static"}},
          {"key":"sweep","count":1,"sprite":{"kind":"stroke"},"motion":{"type":"drift"},"opacity":1}]}
        """)
        XCTAssertEqual(NativeSupport.gaps(in: spec), [])
    }

    func testEachGapIsCaught() throws {
        let cases: [(String, NativeSupport.Gap)] = [
            (#"{"format":"idle-sequence","segments":[{"duration":4000,"scene":{"layers":[]}}]}"#, .sequence),
            (#"{"layers":[\#(layer)],"timeline":{"keys":[{"t":0,"path":"a.opacity","value":0}]}}"#, .timeline),
            (#"{"layers":[\#(layer)],"groups":{"moon":{"opacity":1}}}"#, .groups),
            (#"{"segments":[],"bed":{"layers":[]}}"#, .bed),
            (#"{"layers":[{"key":"a","transform":{"scale":2}}]}"#, .layerTransform),
            (#"{"layers":[{"key":"a","group":"moon"}]}"#, .layerGroup),
            (#"{"layers":[{"key":"a","opacity":0}]}"#, .layerOpacity),
        ]
        for (source, gap) in cases {
            XCTAssertTrue(NativeSupport.gaps(in: try json(source)).contains(gap), "\(gap) not caught in \(source)")
        }
    }

    func testGracefulGapsDoNotCount() throws {
        // A print finish only adds grain; native without it is the same picture.
        XCTAssertTrue(NativeSupport.isFaithful(try json(#"{"layers":[\#(layer)],"finish":{"grain":0.2}}"#)))
        XCTAssertTrue(NativeSupport.isFaithful(nil))
    }

    func testHistoryRoutingFollowsTheGaps() throws {
        let timed = try scene("""
        {"id":56,"seed":7,"spec":{"format":"idle-sequence","segments":[{"duration":4000,"scene":{"schemaVersion":1,"id":"x","label":"x","layers":[\(layer)]}}]}}
        """)
        XCTAssertEqual(timed.nativeGaps, [.sequence])
        XCTAssertTrue(timed.needsWebEngine)
        XCTAssertFalse(timed.isTank)

        let plain = try scene(#"{"id":3,"seed":1,"spec":{"schemaVersion":1,"id":"x","label":"x","layers":[\#(layer)]}}"#)
        XCTAssertFalse(plain.needsWebEngine)

        XCTAssertFalse(try scene(#"{"id":2,"seed":1,"spec":{"id":"warp"}}"#).needsWebEngine)
        XCTAssertTrue(try scene(#"{"id":1,"seed":1,"spec":{"id":"metaquarium"}}"#).needsWebEngine)
    }
}

/// A sequence's still: the segment it spends longest in, not its opening
/// (an ident opens dark and rests on its card).
final class SequencePosterTests: XCTestCase {
    private func seq(_ segments: String) throws -> SequenceSubset {
        try JSONDecoder().decode(SequenceSubset.self, from: Data(#"{"format":"idle-sequence","segments":[\#(segments)]}"#.utf8))
    }
    private func seg(_ label: String, _ duration: String?) -> String {
        let d = duration.map { #","duration":\#($0)"# } ?? ""
        return #"{"scene":{"schemaVersion":1,"id":"\#(label)","label":"\#(label)","layers":[]}\#(d)}"#
    }

    func testLongestSegmentWins() throws {
        let s = try seq([seg("intro", "1500"), seg("body", "9000"), seg("outro", "2000")].joined(separator: ","))
        XCTAssertEqual(s.posterSegment?.scene.label, "body")
    }

    func testADurationlessTailHoldsForeverSoItWins() throws {
        let s = try seq([seg("eclipse · sun", "6000"), seg("rest: eclipse", nil)].joined(separator: ","))
        XCTAssertEqual(s.posterSegment?.scene.label, "rest: eclipse")
    }

    func testTiesGoToTheLaterSegment() throws {
        let s = try seq([seg("a", "3000"), seg("b", "3000")].joined(separator: ","))
        XCTAssertEqual(s.posterSegment?.scene.label, "b")
    }
}

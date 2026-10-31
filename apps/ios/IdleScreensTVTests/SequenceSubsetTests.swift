import XCTest
@testable import IdleScreensTV

final class SequenceSubsetTests: XCTestCase {

    // MARK: - Synthetic resolve fixtures (port of resolveSegment tests)

    /// 10s + 20s + durationless tail, no loop.
    private var heldTail: SequenceSubset {
        try! JSONDecoder().decode(SequenceSubset.self, from: Data("""
        {"format":"idle-sequence","segments":[
          {"key":"a","duration":10000,"scene":{"layers":[]}},
          {"key":"b","duration":20000,"transition":{"type":"morph","dur":2000},"scene":{"layers":[]}},
          {"key":"tail","scene":{"layers":[]}}
        ]}
        """.utf8))
    }

    /// 10s + 20s, loop.
    private var looping: SequenceSubset {
        try! JSONDecoder().decode(SequenceSubset.self, from: Data("""
        {"format":"idle-sequence","loop":true,"segments":[
          {"key":"a","duration":10000,"scene":{"layers":[]}},
          {"key":"b","duration":20000,"scene":{"layers":[]}}
        ]}
        """.utf8))
    }

    func testFormatDetection() {
        XCTAssertTrue(SequenceSubset.isSequenceDocument(format: "idle-sequence"))
        XCTAssertFalse(SequenceSubset.isSequenceDocument(format: "idle-saver"))
        XCTAssertFalse(SequenceSubset.isSequenceDocument(format: nil))
    }

    func testResolveWithinFirstSegment() {
        let r = heldTail.resolve(at: 4)
        XCTAssertEqual(r.index, 0)
        XCTAssertEqual(r.localT, 4, accuracy: 1e-9)
        XCTAssertEqual(r.startT, 0, accuracy: 1e-9)
    }

    func testBoundaryIsHalfOpen() {
        // Exactly at t=10 the first segment has ended; we are at b, localT 0.
        let r = heldTail.resolve(at: 10)
        XCTAssertEqual(r.index, 1)
        XCTAssertEqual(r.localT, 0, accuracy: 1e-9)
        XCTAssertEqual(r.startT, 10, accuracy: 1e-9)
    }

    func testDurationlessTailHoldsForever() {
        let r = heldTail.resolve(at: 500)
        XCTAssertEqual(r.index, 2)
        XCTAssertEqual(r.localT, 470, accuracy: 1e-9)
        XCTAssertNil(heldTail.nextBoundary(after: 500), "held tail must never schedule an advance")
    }

    func testNegativeTimeClampsToStart() {
        let r = heldTail.resolve(at: -3)
        XCTAssertEqual(r.index, 0)
        XCTAssertEqual(r.localT, 0, accuracy: 1e-9)
    }

    func testLoopWrapsModuloTimedPrefix() {
        // Total timed 30s; T=65 -> wrapped 5 -> segment a.
        let r = looping.resolve(at: 65)
        XCTAssertEqual(r.index, 0)
        XCTAssertEqual(r.localT, 5, accuracy: 1e-9)

        // T=40 -> wrapped 10 -> boundary -> segment b at 0.
        let r2 = looping.resolve(at: 40)
        XCTAssertEqual(r2.index, 1)
        XCTAssertEqual(r2.localT, 0, accuracy: 1e-9)
    }

    func testNextBoundaryCountsDown() throws {
        let b = try XCTUnwrap(heldTail.nextBoundary(after: 4))
        XCTAssertEqual(b, 6, accuracy: 1e-9)
        // Looping never runs dry.
        let wrapped = try XCTUnwrap(looping.nextBoundary(after: 65))
        XCTAssertEqual(wrapped, 5, accuracy: 1e-9)
    }

    func testTheOutgoingSegmentOwnsTheCrossing() {
        // b's morph plays b → tail (the web reads segments[from].transition);
        // a has none, so a → b cuts. Empty twins are structural twins.
        XCTAssertEqual(heldTail.crossing(into: 0, wrapped: false), .cut, "nothing precedes segment 0")
        XCTAssertEqual(heldTail.crossing(into: 1, wrapped: false), .cut, "a declares no transition")
        XCTAssertEqual(heldTail.crossing(into: 2, wrapped: false), .morph(from: 1, seconds: 2, text: "step"))
        XCTAssertEqual(heldTail.crossing(into: 99, wrapped: false), .cut, "out of range is safe")
    }

    func testMorphBetweenNonTwinsIsACutAndAWrapFadesFromTheLast() throws {
        let seq = try JSONDecoder().decode(SequenceSubset.self, from: Data(##"""
        {"format":"idle-sequence","loop":true,"segments":[
          {"duration":1000,"transition":{"type":"morph","dur":800},"scene":{"layers":[{"count":3,"sprite":{"kind":"circle"},"motion":{"type":"drift"}}]}},
          {"duration":1000,"transition":{"type":"fade","dur":600},"scene":{"layers":[{"count":4,"sprite":{"kind":"circle"},"motion":{"type":"drift"}}]}}]}
        """##.utf8))
        XCTAssertEqual(seq.crossing(into: 1, wrapped: false), .cut, "count differs: not twins")
        XCTAssertEqual(seq.crossing(into: 0, wrapped: true), .fade(seconds: 0.6))
        XCTAssertEqual(seq.crossing(into: 0, wrapped: false), .cut, "the first mount is not a wrap")
        XCTAssertTrue(seq.hasWrapped(at: 2.0))
        XCTAssertFalse(seq.hasWrapped(at: 1.9))
    }

    func testSegmentSeedsFollowTheWeb() throws {
        // segmentRenderSeed: own seed, else seq.seed + the chain root's index.
        let seq = try JSONDecoder().decode(SequenceSubset.self, from: Data(##"""
        {"format":"idle-sequence","seed":10,"segments":[
          {"duration":1000,"scene":{"layers":[]}},
          {"duration":1000,"transition":{"type":"morph","dur":500},"scene":{"seed":77,"layers":[]}},
          {"duration":1000,"scene":{"layers":[]}},
          {"duration":1000,"scene":{"layers":[]}}]}
        """##.utf8))
        XCTAssertEqual(seq.renderSeed(0, fallback: 5), 10)
        XCTAssertEqual(seq.renderSeed(1, fallback: 5), 77)
        XCTAssertEqual(seq.renderSeed(2, fallback: 5), 77, "morph-chained to segment 1")
        XCTAssertEqual(seq.renderSeed(3, fallback: 5), 13)
    }

    func testEpochSyncStartsOnTheSharedClock() throws {
        let seq = try JSONDecoder().decode(SequenceSubset.self, from: Data(##"""
        {"format":"idle-sequence","sync":"epoch","loop":true,"segments":[
          {"duration":10000,"scene":{"layers":[]}},{"duration":20000,"scene":{"layers":[]}}]}
        """##.utf8))
        let now = Date(timeIntervalSince1970: 1_000_100)
        XCTAssertEqual(TVAppState.sequenceBaseT(seq, epochMs: 1_000_000_000, now: now), 10, accuracy: 1e-9,
                       "100 s in, wrapped into the 30 s lap")
        XCTAssertEqual(TVAppState.sequenceBaseT(seq, epochMs: nil, now: now), 0)
        var mount = seq
        mount.sync = nil
        XCTAssertEqual(TVAppState.sequenceBaseT(mount, epochMs: 1_000_000_000, now: now), 0)
    }

    // MARK: - Production fixture (noble-grove-6b resolvedSpec, 2026-08-14)

    static let nobleGroveJSON = ##"{"format":"idle-sequence","schemaVersion":1,"id":"snow-white","label":"Snow White \u2014 a triptych","seed":7,"loop":true,"segments":[{"key":"act-1","duration":240000,"transition":{"type":"morph","dur":5000},"scene":{"schemaVersion":1,"id":"sw-act-1","label":"Act I \u2014 The Cottage","seed":71,"background":{"type":"solid","color":"#241a12"},"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.0336,0.0336],"color":"#f2ede4","soft":true},"motion":{"type":"path","points":[{"x":0.15,"y":0.6},{"x":0.45,"y":0.45},{"x":0.75,"y":0.58}],"duration":24000,"curve":"smooth","closed":true}},{"count":7,"sprite":{"kind":"circle","radius":[0.0156,0.0234],"color":"#c9a36a","soft":true},"motion":{"type":"drift","speed":[0.008,0.02]}},{"count":1,"sprite":{"kind":"ring","radius":[0.06,0.06],"color":"#7a6a86","width":0.002},"motion":{"type":"static"},"position":{"x":0.85,"y":0.2}},{"count":1,"sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#2a1d14","soft":true},"motion":{"type":"static"},"position":{"x":0.7,"y":0.8}},{"count":30,"sprite":{"kind":"circle","radius":[0.0018,0.0048],"color":"#5c4a38","soft":true},"motion":{"type":"drift","speed":[0.002,0.006],"angle":270}}]}},{"key":"act-2","duration":360000,"transition":{"type":"morph","dur":5000},"scene":{"schemaVersion":1,"id":"sw-act-2","label":"Act II \u2014 The Forest & the Apple","seed":72,"background":{"type":"solid","color":"#0c1410"},"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.0336,0.0336],"color":"#e8f0ea","soft":true},"motion":{"type":"path","points":[{"x":0.15,"y":0.6},{"x":0.45,"y":0.45},{"x":0.75,"y":0.58}],"duration":24000,"curve":"smooth","closed":true}},{"count":7,"sprite":{"kind":"circle","radius":[0.0156,0.0234],"color":"#4a6a52","soft":true},"motion":{"type":"drift","speed":[0.008,0.02]}},{"count":1,"sprite":{"kind":"ring","radius":[0.06,0.06],"color":"#3a4a3e","width":0.002},"motion":{"type":"static"},"position":{"x":0.85,"y":0.2}},{"count":1,"sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#c42a3a","soft":true},"motion":{"type":"static"},"position":{"x":0.7,"y":0.8}},{"count":30,"sprite":{"kind":"circle","radius":[0.0018,0.0048],"color":"#2a3c30","soft":true},"motion":{"type":"drift","speed":[0.002,0.006],"angle":270}}]}},{"key":"act-3","duration":300000,"transition":{"type":"cut"},"scene":{"schemaVersion":1,"id":"sw-act-3","label":"Act III \u2014 The Waking","seed":73,"background":{"type":"solid","color":"#2a2436"},"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.0336,0.0336],"color":"#ffffff","soft":true},"motion":{"type":"path","points":[{"x":0.15,"y":0.6},{"x":0.45,"y":0.45},{"x":0.75,"y":0.58}],"duration":24000,"curve":"smooth","closed":true}},{"count":7,"sprite":{"kind":"circle","radius":[0.0156,0.0234],"color":"#d4b878","soft":true},"motion":{"type":"drift","speed":[0.008,0.02]}},{"count":1,"sprite":{"kind":"ring","radius":[0.06,0.06],"color":"#c8b4d8","width":0.002},"motion":{"type":"static"},"position":{"x":0.85,"y":0.2}},{"count":1,"sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#3a2f42","soft":true},"motion":{"type":"static"},"position":{"x":0.7,"y":0.8}},{"count":30,"sprite":{"kind":"circle","radius":[0.0018,0.0048],"color":"#8a7a9c","soft":true},"motion":{"type":"drift","speed":[0.002,0.006],"angle":270}}]}},{"key":"curtain","scene":{"schemaVersion":1,"id":"sw-curtain","label":"Curtain","seed":79,"background":{"type":"solid","color":"#050408"},"layers":[{"count":30,"sprite":{"kind":"circle","radius":[0.00112,0.0028],"color":"#1a1626","soft":true},"motion":{"type":"drift","speed":[0.001,0.003],"angle":270}}]},"duration":20000}]}"##

    func testNobleGroveDecodesAndEverySegmentCompilesVisible() throws {
        let seq = try JSONDecoder().decode(SequenceSubset.self,
                                           from: Data(Self.nobleGroveJSON.utf8))
        XCTAssertTrue(SequenceSubset.isSequenceDocument(format: seq.format))
        XCTAssertEqual(seq.segments.count, 4)
        XCTAssertEqual(seq.loop, true)

        for (i, seg) in seq.segments.enumerated() {
            let spec = seg.scene
            let layers = spec.compile(seed: spec.seed ?? 1, budget: SpecSubset.Budget.preview)
            XCTAssertFalse(layers.isEmpty, "segment \(i) compiled to nothing")
            let verdict = SceneVisibility.verdict(layers: layers, background: spec.background)
            if i == 3 {
                // "curtain" is authored near-darkness (dim dots on near-black)
                // — pin that it reads invisible, which is WHY sequence
                // playback bypasses the NotBroadcasting gate.
                XCTAssertEqual(verdict, .invisible, "curtain unexpectedly visible")
            } else {
                XCTAssertEqual(verdict, .visible, "segment \(i) would render invisibly")
            }
        }
    }

    func testNobleGroveTimeline() throws {
        let seq = try JSONDecoder().decode(SequenceSubset.self,
                                           from: Data(Self.nobleGroveJSON.utf8))
        // 240 + 360 + 300 + 20 = 920s timed, looping.
        XCTAssertEqual(seq.resolve(at: 0).index, 0)
        XCTAssertEqual(seq.resolve(at: 250).index, 1)
        XCTAssertEqual(seq.resolve(at: 700).index, 2)
        XCTAssertEqual(seq.resolve(at: 910).index, 3)
        // Wrap: 920 -> act-1 again.
        XCTAssertEqual(seq.resolve(at: 920).index, 0)
        XCTAssertEqual(seq.resolve(at: 920 + 250).index, 1)
        // act-1 and act-2 are structural twins (same placement): a true morph.
        XCTAssertEqual(seq.crossing(into: 1, wrapped: false), .morph(from: 0, seconds: 5, text: "step"))
        XCTAssertEqual(seq.crossing(into: 2, wrapped: false), .morph(from: 1, seconds: 5, text: "step"))
        XCTAssertEqual(seq.crossing(into: 3, wrapped: false), .cut, "act-3 declares a cut")
        XCTAssertEqual(seq.renderSeed(2, fallback: 0), 71, "act-3 renders with the chain root's seed")
    }

    // MARK: - advance: 'input' (sequence.test.ts "holds until released")

    private func decode(_ json: String) -> SequenceSubset {
        try! JSONDecoder().decode(SequenceSubset.self, from: Data(json.utf8))
    }

    private var withInput: SequenceSubset {
        decode("""
        {"format":"idle-sequence","segments":[
          {"key":"a","duration":5000,"advance":"input","scene":{"layers":[]}},
          {"key":"b","duration":3000,"scene":{"layers":[]}}
        ]}
        """)
    }

    func testInputHoldsPastItsDurationAndKeepsAnimating() {
        let r = withInput.resolve(at: 6)
        XCTAssertEqual(r.index, 0)
        XCTAssertTrue(r.held)
        XCTAssertEqual(r.localT, 6, accuracy: 1e-9, "the held scene's clock is not frozen at duration")
        XCTAssertNil(withInput.nextBoundary(after: 6), "a hold waits for the clicker, not the timer")
        XCTAssertNil(withInput.nextBoundary(after: 2.5), "nor does the timer schedule the way into one")
    }

    func testInputIsNotHeldInsideItsDuration() {
        let r = withInput.resolve(at: 2.5)
        XCTAssertEqual(r.index, 0)
        XCTAssertFalse(r.held)
    }

    func testAReleaseBelowTheSegmentLetsTheTimerThrough() {
        let r = withInput.resolve(at: 6, releasedBelow: 1)
        XCTAssertEqual(r.index, 1)
        XCTAssertEqual(r.localT, 1, accuracy: 1e-9)
        XCTAssertEqual(r.startT, 5, accuracy: 1e-9)
        XCTAssertFalse(r.held)
    }

    func testAutoAndEitherAdvanceOnTheTimer() {
        for advance in ["auto", "either"] {
            let s = decode("""
            {"format":"idle-sequence","segments":[
              {"key":"a","duration":5000,"advance":"\(advance)","scene":{"layers":[]}},
              {"key":"b","duration":3000,"scene":{"layers":[]}}
            ]}
            """)
            XCTAssertEqual(s.resolve(at: 6).index, 1, advance)
            XCTAssertEqual(try XCTUnwrap(s.nextBoundary(after: 4)), 1, accuracy: 1e-9, advance)
        }
    }

    func testALoopHoldBlocksTheWrapAndAFreshLapReArmsIt() {
        let s = decode("""
        {"format":"idle-sequence","loop":true,"segments":[
          {"key":"a","duration":5000,"scene":{"layers":[]}},
          {"key":"b","duration":3000,"advance":"input","scene":{"layers":[]}}
        ]}
        """)
        let held = s.resolve(at: 9)
        XCTAssertEqual(held.index, 1); XCTAssertTrue(held.held); XCTAssertEqual(held.localT, 4, accuracy: 1e-9)
        let released = s.resolve(at: 9, releasedBelow: 2)
        XCTAssertEqual(released.index, 0); XCTAssertEqual(released.localT, 1, accuracy: 1e-9)
        // Lap 3: modulo, not a one-lap subtract.
        XCTAssertEqual(s.resolve(at: 17, releasedBelow: 2).localT, 1, accuracy: 1e-9)
        let rearmed = s.resolve(at: 8.5)
        XCTAssertEqual(rearmed.index, 1); XCTAssertTrue(rearmed.held); XCTAssertEqual(rearmed.localT, 3.5, accuracy: 1e-9)
    }

    func testInputOnADurationlessTailChangesNothing() {
        let with = decode("""
        {"format":"idle-sequence","segments":[
          {"key":"a","duration":5000,"scene":{"layers":[]}},
          {"key":"b","advance":"input","scene":{"layers":[]}}
        ]}
        """)
        XCTAssertEqual(with.resolve(at: 9), heldTailLike(with).resolve(at: 9))
    }

    private func heldTailLike(_ s: SequenceSubset) -> SequenceSubset {
        var copy = s
        for i in copy.segments.indices { copy.segments[i].advance = nil }
        return copy
    }

    func testSegmentStartIsThePrefixSum() {
        XCTAssertEqual(heldTail.segmentStart(0), 0)
        XCTAssertEqual(heldTail.segmentStart(1), 10)
        XCTAssertEqual(heldTail.segmentStart(2), 30)
        XCTAssertEqual(heldTail.segmentStart(9), 30, "clamped to the last segment")
    }

    func testTheSegmentCueIsTheTracksLastSequenceSegmentDelta() {
        let track: JSONValue = .object(["deltas": .array([
            .object(["path": .string("sequence.segment"), "value": .int(1)]),
            .object(["path": .string("layers.0.opacity"), "value": .double(0.5)]),
            .object(["path": .string("sequence.segment"), "value": .int(3)]),
        ])])
        XCTAssertEqual(TVAppState.segmentCue(track), .object(["path": .string("sequence.segment"), "value": .int(3)]))
        XCTAssertNil(TVAppState.segmentCue(.object(["deltas": .array([])])))
        XCTAssertNil(TVAppState.segmentCue(nil))
    }
}

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

    func testTransitionDurations() {
        XCTAssertEqual(heldTail.transitionDuration(entering: 0), 0, "absent transition = cut")
        XCTAssertEqual(heldTail.transitionDuration(entering: 1), 2, accuracy: 1e-9)
        XCTAssertEqual(heldTail.transitionDuration(entering: 99), 0, "out of range is safe")
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
        // Morph into act-2, cut into act-3.
        XCTAssertEqual(seq.transitionDuration(entering: 1), 5, accuracy: 1e-9)
        XCTAssertEqual(seq.transitionDuration(entering: 2), 0)
    }
}

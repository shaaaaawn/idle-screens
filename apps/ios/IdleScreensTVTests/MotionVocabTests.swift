import XCTest
@testable import IdleScreensTV

/// The motion vocabulary (schema PR #316) on the TV, pinned to the
/// TypeScript: the `in` / `out` / `spring` glide eases, draw-on trims of a
/// line and of a drawing's subpaths, `textBlock.number`'s locale-free
/// formatting, and `life.stagger`'s gate and per-entity envelopes. `rock`
/// rides in StreamParityTests (its phases are part of the entity stream).
final class MotionVocabTests: XCTestCase {

    private struct Golden: Decodable {
        struct Ease: Decodable { let ease: String; let v: [Double] }
        struct XY: Decodable { let x: Double; let y: Double }
        struct Trim: Decodable { let a: Double; let b: Double; let pts: [XY] }
        struct Line: Decodable { let points: [[Double]]; let closed: Bool }
        struct LineTrim: Decodable { let a: Double; let b: Double; let lines: [Line] }
        struct Span: Decodable { let d: StrokeDraw?; let span: [Double]? }
        struct Number: Decodable { let n: TextNumber; let s: String }
        struct Stagger: Decodable {
            struct At: Decodable { let t: Double; let gate: Double; let e: [Double] }
            let life: SpecSubset.Life
            let at: [At]
        }
        let eases: [Ease]
        let trims: [Trim]
        let lineTrims: [LineTrim]
        let drawSpans: [Span]
        let numbers: [Number]
        let stagger: [Stagger]
    }

    private func golden() throws -> Golden {
        let url = try XCTUnwrap(Bundle(for: MotionVocabTests.self).url(forResource: "motion-vocab-golden", withExtension: "json"))
        return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }

    func testGlideEasesMatchTheWeb() throws {
        let ks = [0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1]
        for e in try golden().eases {
            for (k, v) in zip(ks, e.v) {
                XCTAssertEqual(SpecTimeline.easeGlide(e.ease, k), v, accuracy: 1e-12, "\(e.ease) at \(k)")
            }
        }
        XCTAssertEqual(SpecTimeline.steerEases, ["in", "out", "spring"])
    }

    func testDrawOnTrimsMatchTheWeb() throws {
        let g = try golden()
        let poly = [CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 0), CGPoint(x: 10, y: 5), CGPoint(x: 4, y: 9), CGPoint(x: -3, y: 2)]
        for t in g.trims {
            let got = DrawOn.trim(poly, t.a, t.b)
            XCTAssertEqual(got.count, t.pts.count, "span \(t.a)…\(t.b)")
            for (p, q) in zip(got, t.pts) {
                XCTAssertEqual(p.x, q.x, accuracy: 1e-9); XCTAssertEqual(p.y, q.y, accuracy: 1e-9)
            }
        }
        let lines = [
            PathGeometry.Line(points: [(0, 0), (1, 0), (1, 1)], closed: true),
            PathGeometry.Line(points: [(2, 2), (3, 2)], closed: false),
            PathGeometry.Line(points: [(-1, -1), (-1, 1), (0.5, 0.5), (0.2, -0.9)], closed: false),
        ]
        for t in g.lineTrims {
            let got = DrawOn.trim(lines, t.a, t.b)
            XCTAssertEqual(got.count, t.lines.count, "lines \(t.a)…\(t.b)")
            for (l, m) in zip(got, t.lines) {
                XCTAssertEqual(l.closed, m.closed)
                XCTAssertEqual(l.points.count, m.points.count)
                for (p, q) in zip(l.points, m.points) {
                    XCTAssertEqual(p.0, q[0], accuracy: 1e-9); XCTAssertEqual(p.1, q[1], accuracy: 1e-9)
                }
            }
        }
        for s in g.drawSpans {
            let span = (s.d ?? StrokeDraw()).span
            XCTAssertEqual(span.map { [$0.0, $0.1] }, s.span)
        }
    }

    func testCountersFormatLikeTheWeb() throws {
        for n in try golden().numbers { XCTAssertEqual(n.n.formatted, n.s, "\(n.n)") }
        let block = try JSONDecoder().decode(SpecSubset.Sprite.self, from: Data(
            ##"{"kind":"textBlock","text":"0","number":{"value":1234.5,"decimals":1,"suffix":" km"}}"##.utf8))
        guard case .textBlock(let text, _, _, _, _, _, _) = block else { return XCTFail() }
        XCTAssertEqual(text, "1,234.5 km")
    }

    /// JS `toFixed` reads the stored value: 2.55 sits just below its decimal
    /// (2.5), 0.125 and 2.5 are exact ties and round up.
    func testToFixedRoundsTheStoredValueNotTheProduct() {
        XCTAssertEqual(TextNumber.toFixed(2.55, 1), "2.5")
        XCTAssertEqual(TextNumber.toFixed(1.005, 2), "1.00")
        XCTAssertEqual(TextNumber.toFixed(0.125, 2), "0.13")
        XCTAssertEqual(TextNumber.toFixed(2.5, 0), "3")
        XCTAssertEqual(TextNumber.toFixed(0.5, 0), "1")
    }

    func testStaggeredLifeMatchesTheWeb() throws {
        for s in try golden().stagger {
            for a in s.at {
                XCTAssertEqual(s.life.alpha(at: a.t), a.gate, accuracy: 1e-12, "gate at \(a.t)")
                for (i, v) in zip([0, 1, 3, 7], a.e) {
                    XCTAssertEqual(s.life.alpha(at: a.t, entity: i), v, accuracy: 1e-12, "entity \(i) at \(a.t)")
                }
            }
        }
    }

    func testRockIsAStructuralTwinOnlyWithTheSameRock() {
        func scene(_ rock: String) -> JSONValue {
            try! JSONDecoder().decode(JSONValue.self, from: Data(##"{"layers":[{"count":2,"sprite":{"kind":"circle"},"motion":{"type":"static"}\##(rock)}]}"##.utf8))
        }
        XCTAssertEqual(SequenceSubset.structuralSignature(scene(#","rock":{"amp":5,"period":2000}"#)),
                       SequenceSubset.structuralSignature(scene(#","rock":{"amp":5,"period":2000}"#)))
        XCTAssertNotEqual(SequenceSubset.structuralSignature(scene("")),
                          SequenceSubset.structuralSignature(scene(#","rock":{"amp":5,"period":2000}"#)))
    }
}

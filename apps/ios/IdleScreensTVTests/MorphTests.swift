import XCTest
@testable import IdleScreensTV

/// A sequence morph on the TV is the web's: `lerpSpec` (steer.ts) frame for
/// frame — paint fields present on one end glide from identity, a group's
/// paint too, SVG paths with matching commands morph point by point — and
/// `structuralSignature` agrees on which segments are twins. Goldens from the
/// TypeScript (see the README's parity section).
final class MorphTests: XCTestCase {

    private struct Pair: Decodable {
        struct Frame: Decodable { let k: Double; let spec: JSONValue }
        let a: JSONValue, b: JSONValue
        let twins: Bool
        let frames: [Frame]
    }

    private func pairs() throws -> [Pair] {
        let url = try XCTUnwrap(Bundle(for: MorphTests.self).url(forResource: "morph-golden", withExtension: "json"))
        return try JSONDecoder().decode([Pair].self, from: Data(contentsOf: url))
    }

    /// Structural equality with numbers compared by value.
    private func assertClose(_ x: JSONValue, _ y: JSONValue, _ path: String = "$") {
        switch (x, y) {
        case (.object(let a), .object(let b)):
            XCTAssertEqual(Set(a.keys), Set(b.keys), "keys at \(path)")
            for (k, v) in b { if let u = a[k] { assertClose(u, v, "\(path).\(k)") } }
        case (.array(let a), .array(let b)):
            XCTAssertEqual(a.count, b.count, "length at \(path)")
            for (i, (u, v)) in zip(a, b).enumerated() { assertClose(u, v, "\(path)[\(i)]") }
        default:
            if let a = x.number, let b = y.number, x.isNumber, y.isNumber {
                XCTAssertEqual(a, b, accuracy: 1e-9, path)
            } else {
                XCTAssertEqual(x, y, path)
            }
        }
    }

    func testLerpSpecMatchesTheWebFrameForFrame() throws {
        for (i, pair) in try pairs().enumerated() {
            for f in pair.frames {
                assertClose(SpecTimeline.lerpSpec(pair.a, pair.b, f.k), f.spec, "pair \(i) k \(f.k)")
            }
        }
    }

    func testStructuralTwinsAgreeWithTheWeb() throws {
        for (i, pair) in try pairs().enumerated() {
            XCTAssertEqual(SequenceSubset.structuralSignature(pair.a) == SequenceSubset.structuralSignature(pair.b),
                           pair.twins, "pair \(i)")
        }
    }

    func testTextCrossfadePaintsTheOutgoingWordsUnderTheIncoming() throws {
        let p = try pairs()[0]
        let lerped = SpecTimeline.lerpSpec(p.a, p.b, 0.25)
        var layers = try XCTUnwrap(TVAppState.compileJSON(lerped, seed: 3, budget: SpecSubset.Budget.fullscreen))
        MorphText.applyCrossfade(&layers, from: p.a, to: p.b, lerped: lerped, k: 0.25, dip: false)
        XCTAssertNil(layers[0].textCrossfade, "circles have no words")
        let xf = try XCTUnwrap(layers[1].textCrossfade)
        guard case .textBlock(let text, _, _, _, _, _, _) = xf.outgoing else { return XCTFail("not a textBlock") }
        XCTAssertEqual(text, "hello there")
        XCTAssertEqual(xf.aOut, 0.75, accuracy: 1e-12)
        XCTAssertEqual(xf.aIn, 0.25, accuracy: 1e-12)
        // dip: out over the first half, in over the second.
        XCTAssertEqual(MorphText.alphas(k: 0.25, dip: true).0, 0.5, accuracy: 1e-12)
        XCTAssertEqual(MorphText.alphas(k: 0.25, dip: true).1, 0, accuracy: 1e-12)
        XCTAssertEqual(MorphText.alphas(k: 0.75, dip: true).1, 0.5, accuracy: 1e-12)
    }
}

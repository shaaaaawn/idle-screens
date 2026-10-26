import XCTest
@testable import IdleScreensTV

/// textBlock layout and reveal against the TypeScript (simulate.ts):
/// `textWidthEm` / `breakTextBlock` under the proportional and monospace
/// tables (a `font` naming a mono family breaks on a 0.6 em cell, CJK on a
/// full em), and `revealState` including `glyphFade`'s per-glyph alphas.
final class TextParityTests: XCTestCase {

    private struct Golden: Decodable {
        struct Line: Decodable { let text: String; let widthEm: Double }
        struct Break: Decodable {
            let text: String, font: String?, mono: Bool, w: Double, width: Double
            let lines: [Line]
        }
        struct Reveal: Decodable {
            struct Spec: Decodable { let mode: String; let progress: Double?; let speed: Double?; let fade: Double? }
            struct State: Decodable {
                let progress: Double, fullLines: Int, partialText: String, caretLine: Int, caretPrefix: String
                let glyphAlphas: [[Double]]?
            }
            let text: String, reveal: Spec, t: Double, state: State
        }
        let breaks: [Break]
        let reveals: [Reveal]
    }

    private func golden() throws -> Golden {
        let url = try XCTUnwrap(Bundle(for: TextParityTests.self).url(forResource: "text-golden", withExtension: "json"))
        return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }

    func testLineBreaksMatchTheWebUnderBothTables() throws {
        for b in try golden().breaks {
            XCTAssertEqual(isMonoFont(b.font), b.mono, "metrics class of \(b.font ?? "nil")")
            XCTAssertEqual(textWidthEm(b.text, mono: b.mono), b.width, accuracy: 1e-9, "width of \(b.text)")
            let lines = breakTextBlock(text: b.text, maxWidthEm: b.w, mono: b.mono)
            XCTAssertEqual(lines.map(\.text), b.lines.map(\.text), "\(b.text) at \(b.w)em mono=\(b.mono)")
            for (l, g) in zip(lines, b.lines) { XCTAssertEqual(l.widthEm, g.widthEm, accuracy: 1e-9) }
        }
    }

    func testRevealStateMatchesTheWebIncludingGlyphFade() throws {
        for r in try golden().reveals {
            let lines = breakTextBlock(text: r.text, maxWidthEm: 12)
            let spec = SpecSubset.TextRevealSpec(progress: r.reveal.progress, mode: r.reveal.mode,
                                                 speed: r.reveal.speed, caret: nil, fade: r.reveal.fade)
            let s = revealState(lines: lines, reveal: spec, t: r.t / 1000)   // seconds here, ms there
            let label = "\(r.reveal.mode) at \(r.t) on \(r.text.prefix(12))"
            XCTAssertEqual(s.progress, r.state.progress, accuracy: 1e-12, label)
            XCTAssertEqual(s.fullLines, r.state.fullLines, label)
            XCTAssertEqual(s.partialText, r.state.partialText, label)
            XCTAssertEqual(s.caretLine, r.state.caretLine, label)
            XCTAssertEqual(s.caretPrefix, r.state.caretPrefix, label)
            XCTAssertEqual(s.glyphAlphas?.count, r.state.glyphAlphas?.count, label)
            for (a, b) in zip(s.glyphAlphas ?? [], r.state.glyphAlphas ?? []) {
                XCTAssertEqual(a.count, b.count, label)
                for (x, y) in zip(a, b) { XCTAssertEqual(x, y, accuracy: 1e-12, label) }
            }
        }
    }
}

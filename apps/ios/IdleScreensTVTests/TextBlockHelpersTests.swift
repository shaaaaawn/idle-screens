import XCTest
@testable import IdleScreensTV

final class TextBlockHelpersTests: XCTestCase {

    // MARK: - breakTextBlock

    func testSingleWordFits() {
        let lines = breakTextBlock(text: "hello", maxWidthEm: 10)
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].text, "hello")
    }

    func testWrapsAtMaxWidth() {
        // "hello world" with each word ~2.75 em (5 chars × 0.55). Max 4 em
        // should force a break.
        let lines = breakTextBlock(text: "hello world", maxWidthEm: 4)
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0].text, "hello")
        XCTAssertEqual(lines[1].text, "world")
    }

    func testExplicitNewline() {
        let lines = breakTextBlock(text: "a\nb", maxWidthEm: 100)
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0].text, "a")
        XCTAssertEqual(lines[1].text, "b")
    }

    func testConsecutiveNewlines() {
        let lines = breakTextBlock(text: "a\n\nb", maxWidthEm: 100)
        XCTAssertEqual(lines.count, 3)
        XCTAssertEqual(lines[0].text, "a")
        XCTAssertEqual(lines[1].text, "")
        XCTAssertEqual(lines[2].text, "b")
    }

    func testLongWordUnbroken() {
        let lines = breakTextBlock(text: "supercalifragilistic", maxWidthEm: 2)
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].text, "supercalifragilistic")
    }

    func testNarrowAndWideWidths() {
        // 'i' is narrow (0.35), 'm' is wide (0.72)
        let narrow = textWidthEm("iii") // 3 × 0.35 = 1.05
        let wide = textWidthEm("mmm")   // 3 × 0.72 = 2.16
        XCTAssertEqual(narrow, 1.05, accuracy: 1e-10)
        XCTAssertEqual(wide, 2.16, accuracy: 1e-10)
    }

    func testSpaceWidth() {
        let w = textWidthEm(" ")
        XCTAssertEqual(w, 0.3, accuracy: 1e-10)
    }

    // MARK: - graphemeClusters

    func testASCII() {
        XCTAssertEqual(graphemeClusters("abc"), ["a", "b", "c"])
    }

    func testFlagEmoji() {
        let clusters = graphemeClusters("🇺🇸")
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0], "🇺🇸")
    }

    func testZWJSequence() {
        // Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy
        let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"
        let clusters = graphemeClusters(family)
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0], family)
    }

    func testSkinTone() {
        let wave = "\u{1F44B}\u{1F3FD}" // 👋🏽
        let clusters = graphemeClusters(wave)
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0], wave)
    }

    func testCombiningDiacritics() {
        let eCombining = "e\u{0301}" // e + combining acute
        let clusters = graphemeClusters(eCombining)
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0], eCombining)
    }

    func testMixedASCIIAndEmoji() {
        let clusters = graphemeClusters("hi🇺🇸!")
        XCTAssertEqual(clusters, ["h", "i", "🇺🇸", "!"])
    }

    // MARK: - revealState

    func testTypewriterFullProgress() {
        let lines = breakTextBlock(text: "hello world", maxWidthEm: 100)
        let reveal = SpecSubset.TextRevealSpec(progress: 1, mode: "typewriter")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 1)
        XCTAssertEqual(rs.partialText, "")
    }

    func testTypewriterHalfProgress() {
        let lines = breakTextBlock(text: "abcdef", maxWidthEm: 100)
        // 6 graphemes, progress 0.5 → round(3) = 3 visible
        let reveal = SpecSubset.TextRevealSpec(progress: 0.5, mode: "typewriter")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 0)
        XCTAssertEqual(rs.partialText, "abc")
    }

    func testTypewriterZeroProgress() {
        let lines = breakTextBlock(text: "hello", maxWidthEm: 100)
        let reveal = SpecSubset.TextRevealSpec(progress: 0, mode: "typewriter")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 0)
        XCTAssertEqual(rs.partialText, "")
        XCTAssertEqual(rs.caretLine, 0)
        XCTAssertEqual(rs.caretPrefix, "")
    }

    func testWordMode() {
        let lines = breakTextBlock(text: "one two three four", maxWidthEm: 100)
        // 4 words, progress 0.5 → round(2) = 2 words visible
        let reveal = SpecSubset.TextRevealSpec(progress: 0.5, mode: "word")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 0)
        XCTAssertEqual(rs.partialText, "one two")
    }

    func testLineMode() {
        let lines = breakTextBlock(text: "aaa\nbbb\nccc\nddd", maxWidthEm: 100)
        XCTAssertEqual(lines.count, 4)
        // progress 0.5 → round(2) = 2 full lines
        let reveal = SpecSubset.TextRevealSpec(progress: 0.5, mode: "line")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 2)
        XCTAssertEqual(rs.partialText, "")
    }

    func testSpeedLimitsProgress() {
        let lines = breakTextBlock(text: "abcdefghij", maxWidthEm: 100)
        // 10 graphemes, speed = 5/sec, t = 0.5 sec → timed = 5*0.5/10 = 0.25
        // authored progress = 1 → effective = min(1, 0.25) = 0.25
        // round(0.25*10) = 3 visible
        let reveal = SpecSubset.TextRevealSpec(progress: 1, mode: "typewriter",
                                               speed: 5)
        let rs = revealState(lines: lines, reveal: reveal, t: 0.5)
        XCTAssertEqual(rs.partialText, "abc") // first 3 chars, not on a full line
        XCTAssertEqual(rs.progress, 0.25, accuracy: 1e-10)
    }

    func testCaretAtFrontier() {
        let lines = breakTextBlock(text: "abc\ndef", maxWidthEm: 100)
        // 6 graphemes, progress 0.5 → round(3) = 3: fills line 0 ("abc"), no partial
        let reveal = SpecSubset.TextRevealSpec(progress: 0.5, mode: "typewriter")
        let rs = revealState(lines: lines, reveal: reveal, t: 999)
        XCTAssertEqual(rs.fullLines, 1)
        XCTAssertEqual(rs.partialText, "")
        XCTAssertEqual(rs.caretLine, 0) // end of last full line
        XCTAssertEqual(rs.caretPrefix, "abc")
    }

    // MARK: - Decoding

    func testTextBlockDecodes() throws {
        let json = """
        {"layers":[{
          "count":1,
          "sprite":{
            "kind":"textBlock",
            "text":"Hello World",
            "maxWidth":0.6,
            "fontSize":0.04,
            "lineHeight":1.5,
            "align":"center",
            "color":"#aabbcc",
            "reveal":{"progress":0.5,"mode":"typewriter","speed":3,"caret":true}
          },
          "motion":{"type":"static"},
          "position":{"x":0.5,"y":0.3}
        }]}
        """
        let spec = try SpecSubsetTests.decode(json)
        guard case .textBlock(let text, let mw, let fs, let lh, let align,
                              let color, let reveal) = spec.layers[0].sprite else {
            return XCTFail("Expected textBlock sprite")
        }
        XCTAssertEqual(text, "Hello World")
        XCTAssertEqual(mw, 0.6)
        XCTAssertEqual(fs, 0.04)
        XCTAssertEqual(lh, 1.5)
        XCTAssertEqual(align, "center")
        XCTAssertEqual(color, "#aabbcc")
        XCTAssertNotNil(reveal)
        XCTAssertEqual(reveal?.progress, 0.5)
        XCTAssertEqual(reveal?.mode, "typewriter")
        XCTAssertEqual(reveal?.speed, 3)
        XCTAssertNotNil(reveal?.caret)
    }

    func testTextBlockCaretObject() throws {
        let json = """
        {"layers":[{
          "count":1,
          "sprite":{
            "kind":"textBlock","text":"x","maxWidth":0.5,"fontSize":0.03,
            "reveal":{"caret":{"blink":2.5,"color":"#ff0000"}}
          },
          "motion":{"type":"static"}
        }]}
        """
        let spec = try SpecSubsetTests.decode(json)
        guard case .textBlock(_, _, _, _, _, _, let reveal) = spec.layers[0].sprite else {
            return XCTFail("Expected textBlock")
        }
        XCTAssertEqual(reveal?.caret?.blink, 2.5)
        XCTAssertEqual(reveal?.caret?.color, "#ff0000")
    }

    func testTextBlockCompilesSizeWithoutRNG() throws {
        let json = """
        {"layers":[{
          "count":1,
          "sprite":{"kind":"textBlock","text":"hello","maxWidth":0.5,"fontSize":0.04},
          "motion":{"type":"static"},
          "position":{"x":0.1,"y":0.2}
        }]}
        """
        let spec = try SpecSubsetTests.decode(json)
        let layers = spec.compile(seed: 42)
        XCTAssertEqual(layers.count, 1)
        XCTAssertEqual(layers[0].entities.count, 1)
        let entity = layers[0].entities[0]
        XCTAssertEqual(entity.size, 0.04) // fontSize, no rng
        XCTAssertEqual(entity.x, 0.1, accuracy: 1e-10)
        XCTAssertEqual(entity.y, 0.2, accuracy: 1e-10)
    }

    func testTextBlockDoesNotDisturbRNGStream() throws {
        // A spec with a circle layer after a textBlock layer should produce
        // the same circle positions regardless of the textBlock's text content,
        // because textBlock's per-entity draws match the unknown-sprite path.
        let makeJSON = { (text: String) -> String in
            """
            {"seed":99,"layers":[
              {"count":1,"sprite":{"kind":"textBlock","text":"\(text)","maxWidth":0.5,"fontSize":0.04},"motion":{"type":"static"},"position":{"x":0.1,"y":0.1}},
              {"count":3,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},"motion":{"type":"drift","speed":[0.01,0.02],"angle":45}}
            ]}
            """
        }
        let spec1 = try SpecSubsetTests.decode(makeJSON("short"))
        let spec2 = try SpecSubsetTests.decode(makeJSON("a much longer text block content"))
        let layers1 = spec1.compile(seed: 99)
        let layers2 = spec2.compile(seed: 99)
        // Circle layer entities should be identical between the two specs
        XCTAssertEqual(layers1[1].entities.count, layers2[1].entities.count)
        for i in 0..<layers1[1].entities.count {
            XCTAssertEqual(layers1[1].entities[i].x, layers2[1].entities[i].x, accuracy: 1e-15)
            XCTAssertEqual(layers1[1].entities[i].y, layers2[1].entities[i].y, accuracy: 1e-15)
            XCTAssertEqual(layers1[1].entities[i].size, layers2[1].entities[i].size, accuracy: 1e-15)
        }
    }
}

import XCTest
@testable import IdleScreensTV

/// SaverSpec 3.7–3.9 additions, ordered by how many live channels use them.
final class Spec39Tests: XCTestCase {

    private func spec(_ json: String) throws -> SpecSubset {
        try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
    }

    // MARK: - background drift / band / field

    func testDriftMovesStopsOutOfPhaseAndStaysInRange() throws {
        let s = try spec(##"""
        {"background":{"type":"gradient","drift":{"period":20000,"amount":0.2},
          "stops":[{"at":0.2,"color":"#000"},{"at":0.8,"color":"#fff"}]},"layers":[]}
        """##)
        let bg = try XCTUnwrap(s.background)
        XCTAssertEqual(bg.driftedStops(at: 0).map(\.at)[0], 0.2, accuracy: 1e-9, "sin(0) leaves stop 0 home")
        // A quarter period in, stop 0 is at its peak; stop 1 rides half a turn
        // behind, so the two breathe against each other instead of sliding as one.
        let q = bg.driftedStops(at: 5000)
        XCTAssertEqual(q[0].at, 0.4, accuracy: 1e-9)
        XCTAssertEqual(q[1].at, 0.6, accuracy: 1e-9)
        for t in stride(from: 0.0, through: 20000, by: 1234) {
            XCTAssertTrue(bg.driftedStops(at: t).allSatisfy { (0...1).contains($0.at) })
        }
    }

    func testNoDriftLeavesStopsAlone() throws {
        let s = try spec(##"{"background":{"type":"gradient","stops":[{"at":0,"color":"#000"},{"at":1,"color":"#fff"}]},"layers":[]}"##)
        XCTAssertEqual(s.background?.driftedStops(at: 9999).map(\.at), [0, 1])
    }

    func testBandAndFieldDecode() throws {
        let banded = try spec(##"{"background":{"type":"gradient","stops":[{"at":0,"color":"#000"}],"band":{"color":"#123456","height":0.1}},"layers":[]}"##)
        XCTAssertEqual(banded.background?.band?.color, "#123456")
        // A `field` background is not rasterised natively; it must still hand
        // the scene a key colour rather than dropping to black.
        let field = try spec(##"{"background":{"type":"field","scale":2,"bands":["#110000","#aa3300","#ffdd88"]},"layers":[]}"##)
        XCTAssertEqual(field.background?.primaryColor, "#aa3300")
    }

    // MARK: - sequence fade

    func testFadeTransitionDissolvesLikeMorph() throws {
        let seq = try JSONDecoder().decode(SequenceSubset.self, from: Data(##"""
        {"format":"idle-sequence","segments":[
          {"duration":1000,"scene":{"layers":[]}},
          {"duration":1000,"transition":{"type":"fade","dur":1500},"scene":{"layers":[]}},
          {"duration":1000,"transition":{"type":"cut"},"scene":{"layers":[]}}]}
        """##.utf8))
        XCTAssertEqual(seq.transitionDuration(entering: 1), 1.5, accuracy: 1e-9,
                       "fade landed as a hard cut")
        XCTAssertEqual(seq.transitionDuration(entering: 2), 0)
    }

    // MARK: - textBlock style

    func testAnchorOffsetNamesAPointOfTheInk() {
        let centered = SpecSubset.TextStyle(anchor: "center", font: nil, opacity: nil)
        // Left-aligned ink 300 wide, 100 tall: centre is (150, 50) from origin.
        let o = centered.anchorOffset(align: "left", maxWidthPx: 800, widestLinePx: 300, totalHeightPx: 100)
        XCTAssertEqual(o.dx, -150); XCTAssertEqual(o.dy, -50)
        // Centre-aligned ink starts (800-300)/2 in, so its centre is at 400.
        let c = centered.anchorOffset(align: "center", maxWidthPx: 800, widestLinePx: 300, totalHeightPx: 100)
        XCTAssertEqual(c.dx, -400)
        let br = SpecSubset.TextStyle(anchor: "bottom-right", font: nil, opacity: nil)
            .anchorOffset(align: "left", maxWidthPx: 800, widestLinePx: 300, totalHeightPx: 100)
        XCTAssertEqual(br.dx, -300); XCTAssertEqual(br.dy, -100)
        let none = SpecSubset.TextStyle(anchor: nil, font: nil, opacity: nil)
            .anchorOffset(align: "left", maxWidthPx: 800, widestLinePx: 300, totalHeightPx: 100)
        XCTAssertEqual(none.dx, 0); XCTAssertEqual(none.dy, 0)
    }

    func testFontShorthandIsReadForWhatASystemFontCanHonour() {
        func traits(_ f: String) -> (bold: Bool, italic: Bool, design: String) {
            SpecSubset.TextStyle(anchor: nil, font: f, opacity: nil).fontTraits
        }
        XCTAssertEqual(traits("italic 700 1px Georgia, serif").design, "serif")
        XCTAssertTrue(traits("italic 700 1px Georgia, serif").bold)
        XCTAssertTrue(traits("italic 700 1px Georgia, serif").italic)
        XCTAssertEqual(traits("1px ui-monospace, Menlo").design, "mono")
        // "sans-serif" contains "serif" — it must not read as one.
        XCTAssertEqual(traits("1px Helvetica, sans-serif").design, "default")
    }

    func testTextStyleTravelsFromSpriteToCompiledLayer() throws {
        let s = try spec(##"""
        {"seed":1,"layers":[{"count":1,"position":{"x":0.5,"y":0.5},
          "sprite":{"kind":"textBlock","text":"hi","fontSize":0.04,"anchor":"center",
                    "font":"bold 1px serif","opacity":0.6},
          "motion":{"type":"static"}}]}
        """##)
        let style = try XCTUnwrap(s.compile(seed: 1)[0].textStyle)
        XCTAssertEqual(style.anchor, "center")
        XCTAssertEqual(style.opacity, 0.6)
    }

    // MARK: - rotate / clock

    func testStaticRotateHoldsWithoutSpin() throws {
        let s = try spec(##"""
        {"seed":2,"layers":[{"count":3,"rotate":30,
          "sprite":{"kind":"rect","width":[0.05,0.05],"color":"#fff"},"motion":{"type":"static"}}]}
        """##)
        let e = s.compile(seed: 2)[0].entities[0]
        XCTAssertEqual(SceneMotion.rotationDegrees(of: e, at: 0), 30)
        XCTAssertEqual(SceneMotion.rotationDegrees(of: e, at: 99), 30, "no spin, no drift")
    }

    func testRotateRangeIsSeededPerEntity() throws {
        let s = try spec(##"""
        {"seed":2,"layers":[{"count":12,"rotate":[-45,45],
          "sprite":{"kind":"rect","width":[0.05,0.05],"color":"#fff"},"motion":{"type":"static"}}]}
        """##)
        let angles = s.compile(seed: 2)[0].entities.map(\.rotate)
        XCTAssertTrue(angles.allSatisfy { (-45...45).contains($0) })
        XCTAssertGreaterThan(Set(angles).count, 6, "a range should scatter, not repeat")
    }

    func testClockPutsTheWholeLayerInStep() throws {
        let body = ##"{"count":6,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},"alpha":[0.5,0.5],"pulse":{"amp":0.3,"period":2000},"motion":{"type":"static"}"##
        let free = try spec("{\"seed\":4,\"layers\":[\(body)}]}").compile(seed: 4)[0]
        let locked = try spec("{\"seed\":4,\"layers\":[\(body),\"clock\":{\"phase\":0.25}}]}").compile(seed: 4)[0]
        let at = 0.37
        let freeAlphas = Set(free.entities.map { SceneMotion.pulsedAlpha(of: $0, layer: free, at: at) })
        let lockedAlphas = Set(locked.entities.map { SceneMotion.pulsedAlpha(of: $0, layer: locked, at: at) })
        XCTAssertGreaterThan(freeAlphas.count, 1, "unclocked entities pulse on their own phases")
        XCTAssertEqual(lockedAlphas.count, 1, "a clocked layer breathes as one")
        // phase 0.25 of a cycle = the sine's peak at t = 0.
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: locked.entities[0], layer: locked, at: 0), 0.8, accuracy: 1e-9)
    }
}

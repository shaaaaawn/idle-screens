import XCTest
@testable import IdleScreensTV

final class SceneVisibilityTests: XCTestCase {

    private func compile(_ json: String) -> (layers: [CompiledLayer], bg: SpecSubset.Background?) {
        let spec = try! JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        return (spec.compile(seed: 42), spec.background)
    }

    func testSubPixelDarkDotsAreInvisible() {
        // cold-lantern's real failure mode: tiny near-black dots, no background.
        let s = compile("""
        {"layers":[{"count":60,"sprite":{"kind":"circle","radius":[1,2],"color":"#2a3a4a"},
                    "motion":{"type":"drift","speed":[2,6]}}],"units":"px"}
        """)
        XCTAssertEqual(SceneVisibility.verdict(layers: s.layers, background: s.bg), .invisible)
    }

    func testFractionalPxRadiiAreInvisible() {
        // aurora's failure mode: viewport-style fractions stamped px — sub-pixel.
        let s = compile("""
        {"layers":[{"count":100,"sprite":{"kind":"circle","radius":[0.055,0.11],"color":"#1fd68a"},
                    "alpha":[0.04,0.1],"blend":"lighter","motion":{"type":"drift","speed":[2,6]}}],"units":"px"}
        """)
        XCTAssertEqual(SceneVisibility.verdict(layers: s.layers, background: s.bg), .invisible)
    }

    func testBigGlowingBlobsAreVisible() {
        // kimi-3-like: large soft circles, low alpha but huge area + contrast.
        let s = compile("""
        {"background":{"type":"gradient","stops":[{"at":0,"color":"#06121f"},{"at":1,"color":"#0f2a3a"}]},
         "layers":[{"count":10,"sprite":{"kind":"circle","radius":[60,140],"color":"#66d9ff"},
                    "alpha":[0.2,0.4],"motion":{"type":"drift","speed":[3,8]}}],"units":"px"}
        """)
        XCTAssertEqual(SceneVisibility.verdict(layers: s.layers, background: s.bg), .visible)
    }

    func testSparseLanternsAreVisible() {
        // lobby-like: a handful of small bright lanterns on a dark sky must
        // NOT be flagged — sparse is a valid ambient aesthetic.
        let s = compile("""
        {"background":{"type":"gradient","stops":[{"at":0,"color":"#0a0a1e"},{"at":1,"color":"#2a1a3e"}]},
         "layers":[{"count":9,"sprite":{"kind":"circle","radius":[14,26],"color":"#ff9a3c"},
                    "alpha":[0.7,1.0],"motion":{"type":"rise","speed":[4,10]}}],"units":"px"}
        """)
        XCTAssertEqual(SceneVisibility.verdict(layers: s.layers, background: s.bg), .visible)
    }

    func testDefaultSizedTextIsVisible() {
        // gemini-inspire-like: positioned HUD text with engine-default sizing.
        let s = compile("""
        {"background":{"type":"gradient","stops":[{"at":0,"color":"#001a33"},{"at":1,"color":"#000010"}]},
         "layers":[{"count":1,"position":{"x":0.5,"y":0.1},
                    "sprite":{"kind":"text","strings":["GEMINI MCP HUB"],"color":"#99ccff"},
                    "motion":{"type":"static"}}],"units":"px"}
        """)
        XCTAssertEqual(SceneVisibility.verdict(layers: s.layers, background: s.bg), .visible)
    }

    func testEmptySceneIsInvisible() {
        XCTAssertEqual(SceneVisibility.verdict(layers: [], background: nil), .invisible)
    }
}

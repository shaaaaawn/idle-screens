import XCTest
@testable import IdleScreensTV

final class UnitsTests: XCTestCase {
    /// Mirrors lobby's lanterns spec: px units, sub-pixel radii.
    static let lanternsJSON = """
    {
      "schemaVersion": 1,
      "id": "lanterns",
      "label": "Lanterns",
      "seed": 5,
      "units": "px",
      "background": { "type": "solid", "color": "#0b0b12" },
      "layers": [
        {
          "count": 20,
          "sprite": { "kind": "circle", "radius": [0.5, 1.5], "color": "#ffd9a0", "soft": true },
          "motion": { "type": "drift", "speed": [10, 20], "angle": 0 }
        }
      ]
    }
    """

    func testPxUnitsDecode() throws {
        let spec = try SpecSubsetTests.decode(Self.lanternsJSON)
        XCTAssertEqual(spec.units, .px)
    }

    func testPxCompileKeepsRawValues() throws {
        let spec = try SpecSubsetTests.decode(Self.lanternsJSON)
        let layers = spec.compile(seed: 5)
        XCTAssertEqual(layers.count, 1)
        XCTAssertEqual(layers[0].units, .px)
        XCTAssertEqual(layers[0].entities.count, 20)
        for entity in layers[0].entities {
            // Radius stays in raw px — no scaling baked into compile.
            XCTAssertGreaterThanOrEqual(entity.size, 0.5)
            XCTAssertLessThanOrEqual(entity.size, 1.5)
            // angle 0 = rightward: vx in the px speed range, vy zero.
            XCTAssertGreaterThanOrEqual(entity.vx, 10)
            XCTAssertLessThanOrEqual(entity.vx, 20)
            XCTAssertEqual(entity.vy, 0, accuracy: 1e-9)
            // Positions remain fractions of the viewport, unscaled.
            XCTAssertGreaterThanOrEqual(entity.x, 0)
            XCTAssertLessThanOrEqual(entity.x, 1)
            XCTAssertGreaterThanOrEqual(entity.y, 0)
            XCTAssertLessThanOrEqual(entity.y, 1)
        }
    }

    func testViewportUnitsDefaultWhenAbsent() throws {
        // The snowfall fixture has no "units" key → viewport default.
        let spec = try SpecSubsetTests.decode(SpecSubsetTests.snowfallJSON)
        XCTAssertNil(spec.units)
        let layers = spec.compile(seed: 12)
        XCTAssertEqual(layers[0].units, .viewport)
    }

    func testViewportUnitsExplicit() throws {
        let json = """
        {"units":"viewport","layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.001,0.002],"color":"#fff"},"motion":{"type":"drift","speed":[0.01,0.02]}}]}
        """
        let spec = try SpecSubsetTests.decode(json)
        XCTAssertEqual(spec.units, .viewport)
        let layers = spec.compile(seed: 1)
        XCTAssertEqual(layers[0].units, .viewport)
        let entity = layers[0].entities[0]
        XCTAssertGreaterThanOrEqual(entity.size, 0.001)
        XCTAssertLessThanOrEqual(entity.size, 0.002)
    }
}

final class ClassicSpecTests: XCTestCase {
    func testClassicSpecDecodeThrows() {
        XCTAssertThrowsError(try SpecSubsetTests.decode(#"{"id":"warp"}"#))
    }

    @MainActor
    func testApplySpecSetsClassicFlag() throws {
        let app = Self.makeApp()
        let classic = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"id":"warp"}"#.utf8))
        app.handle(.scene(spec: classic, seed: nil))
        XCTAssertTrue(app.isClassicSpec)
        XCTAssertTrue(app.compiledScene.isEmpty)
        XCTAssertEqual(app.currentSpecJSON, classic)
    }

    @MainActor
    func testLaterSchemaSpecClearsClassicFlag() throws {
        let app = Self.makeApp()
        let classic = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"id":"warp"}"#.utf8))
        app.handle(.scene(spec: classic, seed: nil))
        XCTAssertTrue(app.isClassicSpec)

        // Re-publish scenario: a valid schema spec arrives on the same channel.
        let snowfall = try JSONDecoder().decode(JSONValue.self, from: Data(SpecSubsetTests.snowfallJSON.utf8))
        app.handle(.scene(spec: snowfall, seed: nil))
        XCTAssertFalse(app.isClassicSpec)
        XCTAssertEqual(app.compiledScene.count, 3)
        XCTAssertNotNil(app.specBackground)
    }

    @MainActor
    func testSnapshotClassicAlsoFlags() throws {
        let app = Self.makeApp()
        let classic = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"id":"toasters"}"#.utf8))
        app.handle(.snapshot(ChannelSnapshot(resolvedSpec: classic, epoch: 2, sleeping: false)))
        XCTAssertTrue(app.isClassicSpec)
    }

    @MainActor
    private static func makeApp() -> TVAppState {
        let baseURL = URL(string: "https://example.com")!
        return TVAppState(
            gallery: GalleryClient(baseURL: baseURL),
            mcp: MCPClient(baseURL: baseURL),
            ws: ChannelWSClient(),
            baseURL: baseURL
        )
    }
}

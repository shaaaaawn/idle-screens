import XCTest
@testable import IdleScreensTV

final class SpecSubsetTests: XCTestCase {
    static func decode(_ json: String) throws -> SpecSubset {
        try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
    }

    // MARK: Fixtures (mirrors packages/schema/src/examples/*.ts)

    static let snowfallJSON = """
    {
      "schemaVersion": 1,
      "id": "snowfall",
      "label": "Snowfall",
      "seed": 12,
      "motionIntensity": "calm",
      "background": {
        "type": "gradient",
        "stops": [
          { "at": 0, "color": "#0a1628" },
          { "at": 0.7, "color": "#0d1f3c" },
          { "at": 1, "color": "#121212" }
        ]
      },
      "layers": [
        {
          "count": 50,
          "sprite": { "kind": "circle", "radius": [0.0009259, 0.002315], "color": "#8899aa" },
          "motion": { "type": "drift", "angle": 90, "speed": [0.01389, 0.03704], "bob": 0.002778 }
        },
        {
          "count": 35,
          "sprite": { "kind": "circle", "radius": [0.001852, 0.004167], "color": "#c0cdd8" },
          "motion": { "type": "drift", "angle": 85, "speed": [0.03241, 0.07407], "bob": 0.005556 }
        },
        {
          "count": 15,
          "sprite": { "kind": "circle", "radius": [0.003241, 0.006481], "color": "#e8eff5" },
          "motion": { "type": "drift", "angle": 82, "speed": [0.05093, 0.1111], "bob": 0.009259 }
        }
      ]
    }
    """

    static let auroraJSON = """
    {
      "schemaVersion": 1,
      "id": "aurora",
      "label": "Aurora",
      "seed": 66,
      "motionIntensity": "calm",
      "ghosting": 0.85,
      "background": {
        "type": "gradient",
        "stops": [
          { "at": 0, "color": "#02030d" },
          { "at": 0.65, "color": "#050a18" },
          { "at": 1, "color": "#0a1220" }
        ],
        "drift": { "period": 40000, "amount": 0.1 }
      },
      "layers": [
        {
          "key": "stars",
          "count": 110,
          "sprite": { "kind": "circle", "radius": [0.0005, 0.0015], "color": "#e8ecff", "soft": true },
          "motion": { "type": "static" },
          "region": { "y": [0, 0.75] },
          "alpha": [0.2, 0.6],
          "pulse": { "amp": 0.25, "period": 6000, "wave": { "wavelength": 0.5, "angle": 15 } }
        },
        {
          "key": "curtain-green",
          "count": 100,
          "sprite": {
            "kind": "circle",
            "radius": [0.055, 0.11],
            "color": "#1fd68a",
            "soft": true,
            "colors": ["#1fd68a", "#2ee6c8", "#4bd1ff"],
            "colorWeights": [5, 2, 1]
          },
          "motion": { "type": "wander", "speed": [0.004, 0.012], "angle": 0, "meander": 0.13, "coherence": 0.7 },
          "region": { "y": [0.1, 0.42] },
          "alpha": [0.04, 0.1],
          "blend": "lighter",
          "grow": { "amp": 0.25, "period": 9000 }
        },
        {
          "key": "fireflies",
          "count": 14,
          "sprite": { "kind": "circle", "radius": [0.001, 0.003], "color": "#b8ffe1", "soft": true },
          "motion": { "type": "wander", "speed": [0.006, 0.02], "meander": 0.06 },
          "region": { "y": [0.55, 0.95] },
          "alpha": [0.2, 0.55],
          "pulse": { "amp": 0.3, "period": 3500 },
          "blend": "lighter"
        }
      ]
    }
    """

    // MARK: Snowfall

    func testSnowfallDecodes() throws {
        let spec = try Self.decode(Self.snowfallJSON)
        XCTAssertEqual(spec.schemaVersion, 1)
        XCTAssertEqual(spec.id, "snowfall")
        XCTAssertEqual(spec.seed, 12)
        XCTAssertEqual(spec.layers.count, 3)
        XCTAssertEqual(spec.layers.map(\.count), [50, 35, 15])

        XCTAssertEqual(spec.background?.stops?.count, 3)
        XCTAssertEqual(spec.background?.stops?.first?.color, "#0a1628")

        let first = spec.layers[0]
        guard case .circle(let radius, let color, let colors, let soft) = first.sprite else {
            return XCTFail("Expected circle sprite, got \(first.sprite)")
        }
        XCTAssertEqual(radius.0, 0.0009259, accuracy: 1e-7)
        XCTAssertEqual(radius.1, 0.002315, accuracy: 1e-7)
        XCTAssertEqual(color, "#8899aa")
        XCTAssertEqual(colors, ["#8899aa"])
        XCTAssertFalse(soft)

        XCTAssertEqual(first.motion.type, "drift")
        XCTAssertEqual(first.motion.angle, 90)
        XCTAssertEqual(first.motion.speed, [0.01389, 0.03704])
    }

    func testSnowfallCompilesWithDownwardDrift() throws {
        let spec = try Self.decode(Self.snowfallJSON)
        let layers = spec.compile(seed: 12)
        XCTAssertEqual(layers.count, 3)
        // angle 90 = straight down: vy positive, |vx| small.
        for entity in layers[0].entities {
            XCTAssertGreaterThan(entity.vy, 0)
            XCTAssertLessThan(abs(entity.vx), entity.vy)
        }
    }

    // MARK: Aurora

    func testAuroraDecodesUnknownFieldsLeniently() throws {
        let spec = try Self.decode(Self.auroraJSON)
        XCTAssertEqual(spec.layers.count, 3)

        let stars = spec.layers[0]
        XCTAssertEqual(stars.motion.type, "static")
        XCTAssertEqual(stars.alpha, [0.2, 0.6])
        XCTAssertEqual(stars.pulse, SpecSubset.Pulse(amp: 0.25, period: 6000))
        XCTAssertEqual(stars.region?.y, [0, 0.75])

        let curtain = spec.layers[1]
        XCTAssertEqual(curtain.blend, "lighter")
        XCTAssertEqual(curtain.motion.type, "wander")
        guard case .circle(_, _, let colors, let soft) = curtain.sprite else {
            return XCTFail("Expected circle sprite")
        }
        XCTAssertEqual(colors, ["#1fd68a", "#2ee6c8", "#4bd1ff"])
        XCTAssertTrue(soft)
    }

    func testWanderMotionDegradesToDrift() throws {
        let spec = try Self.decode(Self.auroraJSON)
        let layers = spec.compile(seed: 66)
        // Static layer: no velocity. Wander layers: treated as drift, moving.
        for entity in layers[0].entities {
            XCTAssertEqual(entity.vx, 0)
            XCTAssertEqual(entity.vy, 0)
        }
        let curtain = layers[1].entities
        XCTAssertFalse(curtain.isEmpty)
        XCTAssertTrue(curtain.contains { $0.vx != 0 || $0.vy != 0 })
    }

    // MARK: Sprite / spin decoding

    func testSpinScalarAndRange() throws {
        let scalar = """
        {"layers":[{"count":1,"sprite":{"kind":"emoji","glyphs":["✦"]},"motion":{"type":"drift","speed":[0.01,0.02]},"spin":45}]}
        """
        let range = """
        {"layers":[{"count":1,"sprite":{"kind":"emoji","glyphs":["✦"]},"motion":{"type":"drift","speed":[0.01,0.02]},"spin":[10,20]}]}
        """
        let s = try Self.decode(scalar)
        XCTAssertEqual(s.layers[0].spin, SpecSubset.Spin(min: 45, max: 45))
        let r = try Self.decode(range)
        XCTAssertEqual(r.layers[0].spin, SpecSubset.Spin(min: 10, max: 20))
    }

    func testEmojiAndTextSpritesDecode() throws {
        let json = """
        {"layers":[
          {"count":3,"sprite":{"kind":"emoji","glyphs":["🐟","🐠"]},"motion":{"type":"drift","speed":[0.01,0.02]}},
          {"count":1,"sprite":{"kind":"text","strings":["hello"],"color":"#ff0000"},"motion":{"type":"static"}}
        ]}
        """
        let spec = try Self.decode(json)
        guard case .emoji(let glyphs) = spec.layers[0].sprite else {
            return XCTFail("Expected emoji sprite")
        }
        XCTAssertEqual(glyphs, ["🐟", "🐠"])
        guard case .text(let strings, let color) = spec.layers[1].sprite else {
            return XCTFail("Expected text sprite")
        }
        XCTAssertEqual(strings, ["hello"])
        XCTAssertEqual(color, "#ff0000")
    }

    func testRingRectStreakDecode() throws {
        let json = """
        {"layers":[
          {"count":1,"sprite":{"kind":"ring","radius":[0.01,0.02],"color":"#fff","width":2},"motion":{"type":"static"}},
          {"count":1,"sprite":{"kind":"rect","width":[0.01,0.03],"aspect":[0.5,1],"color":"#fff"},"motion":{"type":"static"}},
          {"count":1,"sprite":{"kind":"streak","length":[0.02,0.05],"color":"#fff","width":1.5},"motion":{"type":"drift","speed":[0.1,0.2],"angle":90}}
        ]}
        """
        let spec = try Self.decode(json)
        guard case .ring(let r, _, _, let w) = spec.layers[0].sprite else {
            return XCTFail("Expected ring")
        }
        XCTAssertEqual(r.0, 0.01)
        XCTAssertEqual(w, 2)
        guard case .rect(let rw, let aspect, _, _) = spec.layers[1].sprite else {
            return XCTFail("Expected rect")
        }
        XCTAssertEqual(rw.1, 0.03)
        XCTAssertEqual(aspect.0, 0.5)
        guard case .streak(let l, _, _, let sw) = spec.layers[2].sprite else {
            return XCTFail("Expected streak")
        }
        XCTAssertEqual(l.1, 0.05)
        XCTAssertEqual(sw, 1.5)
    }
}

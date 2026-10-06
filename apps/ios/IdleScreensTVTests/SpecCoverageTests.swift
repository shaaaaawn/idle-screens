import XCTest
@testable import IdleScreensTV

/// Coverage of the SaverSpec features the renderer newly understands. Each
/// case pins the behaviour against packages/schema (simulate.ts / shapes.ts),
/// which is the contract the web engine renders from.
final class SpecCoverageTests: XCTestCase {

    private func compile(_ json: String) throws -> [CompiledLayer] {
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        return spec.compile(seed: spec.seed ?? 1)
    }

    // MARK: - Sprite kinds

    func testEverySchemaSpriteKindDecodes() throws {
        // The ten kinds packages/schema/src/types.ts defines. `unknown` here
        // means the layer draws nothing at all, which is how `stroke` channels
        // came out blank.
        let kinds: [(String, String)] = [
            ("circle", ##"{"kind":"circle","radius":[0.01,0.02],"color":"#fff"}"##),
            ("ring", ##"{"kind":"ring","radius":[0.01,0.02],"color":"#fff"}"##),
            ("rect", ##"{"kind":"rect","width":[0.01,0.02],"color":"#fff"}"##),
            ("streak", ##"{"kind":"streak","length":[0.01,0.02],"color":"#fff"}"##),
            ("emoji", ##"{"kind":"emoji","glyphs":["✦"]}"##),
            ("text", ##"{"kind":"text","strings":["hi"],"color":"#fff"}"##),
            ("textBlock", ##"{"kind":"textBlock","text":"hi","fontSize":0.03}"##),
            ("polygon", ##"{"kind":"polygon","radius":[0.01,0.02],"color":"#fff","sides":5}"##),
            ("stroke", ##"{"kind":"stroke","length":[0.02,0.04],"points":[[-1,0],[0,0.4],[1,0]],"color":"#fff"}"##),
            ("bar", ##"{"kind":"bar","values":[1,2],"length":0.2,"thickness":0.02,"color":"#fff"}"##),
        ]
        for (name, sprite) in kinds {
            let layers = try compile("""
            {"seed":3,"layers":[{"count":2,"sprite":\(sprite),
              "motion":{"type":"drift","speed":[0.01,0.02]}}]}
            """)
            XCTAssertEqual(layers.count, 1, "\(name) layer dropped")
            XCTAssertNotEqual(layers[0].sprite, .unknown, "\(name) decoded as unknown — it would draw nothing")
            XCTAssertEqual(layers[0].entities.count, 2, "\(name) built no entities")
        }
    }

    func testPolygonPointsRegularNGonIsPointUp() {
        let pts = NativeSceneView.polygonPoints(sides: 6, points: nil, radius: 10)
        XCTAssertEqual(pts.count, 6)
        // First vertex straight up (canvas y grows downward).
        XCTAssertEqual(pts[0].x, 0, accuracy: 1e-9)
        XCTAssertEqual(pts[0].y, -10, accuracy: 1e-9)
        // All vertices sit on the circumradius.
        for p in pts { XCTAssertEqual(hypot(p.x, p.y), 10, accuracy: 1e-9) }
    }

    func testPolygonCustomPointsScaleByRadius() {
        let pts = NativeSceneView.polygonPoints(sides: nil, points: [[-1, -1], [1, -1], [0, 1]], radius: 8)
        XCTAssertEqual(pts.map(\.x), [-8, 8, 0])
        XCTAssertEqual(pts.map(\.y), [-8, -8, 8])
    }

    func testStrokeSamplesSpanTheUnitBoxAndCurve() {
        let straight = NativeSceneView.strokeSamples(points: [[-1, 0], [1, 0]],
                                                     halfSize: 10, smooth: true)
        XCTAssertEqual(straight.first!.x, -10, accuracy: 1e-9)
        XCTAssertEqual(straight.last!.x, 10, accuracy: 1e-9)
        // Two control points are a straight segment even when smooth.
        XCTAssertTrue(straight.allSatisfy { abs($0.y) < 1e-9 })

        // A three-point arc must actually bow away from the chord.
        let curved = NativeSceneView.strokeSamples(points: [[-1, 0], [0, 1], [1, 0]],
                                                   halfSize: 10, smooth: true)
        XCTAssertGreaterThan(curved.map(\.y).max()!, 5)
    }

    func testStrokeTaperThinsEndsAndPeaksMidMark() {
        XCTAssertEqual(NativeSceneView.strokeTaper(0.5), 1, accuracy: 1e-9)
        XCTAssertEqual(NativeSceneView.strokeTaper(0), 0.15, accuracy: 1e-9, "floored, never vanishes")
        XCTAssertEqual(NativeSceneView.strokeTaper(1), 0.15, accuracy: 1e-9)
    }

    func testBarFractionUsesMaxAndWrapsIndex() {
        let values = [5.0, 10.0]
        XCTAssertEqual(NativeSceneView.barFraction(values: values, max: nil, index: 0), 0.5)
        XCTAssertEqual(NativeSceneView.barFraction(values: values, max: nil, index: 1), 1.0)
        XCTAssertEqual(NativeSceneView.barFraction(values: values, max: 20, index: 1), 0.5)
        XCTAssertEqual(NativeSceneView.barFraction(values: values, max: nil, index: 2), 0.5, "wraps")
        XCTAssertEqual(NativeSceneView.barFraction(values: [], max: nil, index: 0), 0)
        XCTAssertEqual(NativeSceneView.barFraction(values: [0, 0], max: nil, index: 0), 0, "no divide by zero")
    }

    func testBarBoxGrowsFromTheOrigin() {
        let right = NativeSceneView.barBox(direction: "right", length: 10, thickness: 2)
        XCTAssertEqual(right.minX, 0); XCTAssertEqual(right.maxX, 10)
        let left = NativeSceneView.barBox(direction: "left", length: 10, thickness: 2)
        XCTAssertEqual(left.maxX, 0); XCTAssertEqual(left.minX, -10)
        let up = NativeSceneView.barBox(direction: "up", length: 10, thickness: 2)
        XCTAssertEqual(up.maxY, 0); XCTAssertEqual(up.minY, -10)
    }

    func testBarLayerConsumesNoSeededSizeDraw() throws {
        // A bar's length is a fixed spec value; every entity gets it.
        let layers = try compile("""
        {"seed":9,"layers":[{"count":4,"sprite":{"kind":"bar","values":[1,2,3,4],
          "length":0.25,"thickness":0.03,"color":"#fff"},
          "motion":{"type":"static"}}]}
        """)
        XCTAssertTrue(layers[0].entities.allSatisfy { $0.size == 0.25 })
        XCTAssertEqual(layers[0].entities.map(\.barIndex), [0, 1, 2, 3])
        XCTAssertTrue(layers[0].entities.allSatisfy { $0.thickness == 0.03 })
    }

    // MARK: - life

    func testLifeEnvelopeMatchesSchema() {
        let life = SpecSubset.Life(enter: 1000, exit: 5000, fade: 500)
        XCTAssertEqual(life.alpha(at: 0), 0, "before enter")
        XCTAssertEqual(life.alpha(at: 999), 0)
        XCTAssertEqual(life.alpha(at: 1250), 0.5, accuracy: 1e-9, "half way in")
        XCTAssertEqual(life.alpha(at: 3000), 1, accuracy: 1e-9)
        XCTAssertEqual(life.alpha(at: 5250), 0.5, accuracy: 1e-9, "half way out")
        XCTAssertEqual(life.alpha(at: 6000), 0, accuracy: 1e-9, "gone")
        XCTAssertEqual(SpecSubset.Life(enter: nil, exit: nil, fade: nil).alpha(at: 12345), 1)
    }

    func testLifeDecodesOntoTheLayer() throws {
        let layers = try compile("""
        {"seed":1,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},
          "motion":{"type":"static"},"life":{"enter":200,"exit":800,"fade":100}}]}
        """)
        XCTAssertEqual(layers[0].life?.enter, 200)
        XCTAssertEqual(layers[0].life?.alpha(at: 0), 0)
        XCTAssertEqual(layers[0].life?.alpha(at: 500), 1)
    }

    // MARK: - layout

    func testGridLayoutPlacesRowMajorCells() throws {
        let layers = try compile("""
        {"seed":4,"layers":[{"count":4,"sprite":{"kind":"rect","width":[0.05,0.05],"color":"#fff"},
          "motion":{"type":"static"},"layout":{"type":"grid","columns":2}}]}
        """)
        let e = layers[0].entities
        XCTAssertEqual(e.count, 4)
        // Two columns, two rows, cell centres at the quarter points.
        XCTAssertEqual(e[0].x, 0.25, accuracy: 1e-9)
        XCTAssertEqual(e[0].y, 0.25, accuracy: 1e-9)
        XCTAssertEqual(e[1].x, 0.75, accuracy: 1e-9)
        XCTAssertEqual(e[1].y, 0.25, accuracy: 1e-9)
        XCTAssertEqual(e[2].y, 0.75, accuracy: 1e-9, "second row")
    }

    func testListLayoutStacksFromAnAnchor() throws {
        let layers = try compile("""
        {"seed":4,"layers":[{"count":3,"sprite":{"kind":"text","strings":["a"],"color":"#fff"},
          "motion":{"type":"static"},"position":{"x":0.2,"y":0.1},
          "layout":{"type":"list","gap":0.05}}]}
        """)
        let e = layers[0].entities
        XCTAssertEqual(e.map(\.x), [0.2, 0.2, 0.2], "one column")
        XCTAssertEqual(e[0].y, 0.1, accuracy: 1e-9)
        XCTAssertEqual(e[1].y, 0.15, accuracy: 1e-9)
        XCTAssertEqual(e[2].y, 0.20, accuracy: 1e-9)
    }

    func testTableLayoutWrapsAcrossColumns() throws {
        let layers = try compile("""
        {"seed":4,"layers":[{"count":4,"sprite":{"kind":"text","strings":["a"],"color":"#fff"},
          "motion":{"type":"static"},"position":{"x":0.1,"y":0.1},
          "layout":{"type":"table","columns":2,"gap":{"x":0.3,"y":0.2}}}]}
        """)
        let e = layers[0].entities
        XCTAssertEqual(e[0].x, 0.1, accuracy: 1e-9)
        XCTAssertEqual(e[1].x, 0.4, accuracy: 1e-9)
        XCTAssertEqual(e[2].x, 0.1, accuracy: 1e-9, "wrapped to row 2")
        XCTAssertEqual(e[2].y, 0.3, accuracy: 1e-9)
    }

    func testLayoutBurnsTheSameDrawsAsScatter() throws {
        // Placement is structural: toggling a layout must not disturb the
        // layer's alpha stream (web parity — the two scatter draws are burned).
        let body = """
        {"count":6,"sprite":{"kind":"circle","radius":[0.01,0.03],"color":"#fff"},
         "alpha":[0.2,0.9],"motion":{"type":"static"}
        """
        let scattered = try compile("{\"seed\":11,\"layers\":[\(body)}]}")
        let laidOut = try compile("{\"seed\":11,\"layers\":[\(body),\"layout\":{\"type\":\"list\"}}]}")
        XCTAssertEqual(scattered[0].entities.map(\.alpha),
                       laidOut[0].entities.map(\.alpha),
                       "a layout changed more than placement")
    }

    // MARK: - motion: path

    func testPathMotionDecodesAndTraverses() throws {
        let layers = try compile("""
        {"seed":2,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"path","duration":4000,"closed":true,
                    "points":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}]}}]}
        """)
        let e = layers[0].entities[0]
        XCTAssertEqual(e.motionType, "path", "path fell back to drift")
        let p = try XCTUnwrap(e.path)
        XCTAssertEqual(p.points.count, 4)
        XCTAssertTrue(p.closed)

        // Walk the loop: a closed square returns to where it started.
        let size = CGSize(width: 100, height: 100)
        var zeroed = e
        zeroed.path?.phase = 0
        let a = SceneMotion.position(of: zeroed, at: 0, in: size, dim: 100, wrap: false)
        let b = SceneMotion.position(of: zeroed, at: 4, in: size, dim: 100, wrap: false)
        XCTAssertEqual(a.x, b.x, accuracy: 1e-6)
        XCTAssertEqual(a.y, b.y, accuracy: 1e-6)
        // A quarter of the way along the square is the second corner.
        let q = SceneMotion.position(of: zeroed, at: 1, in: size, dim: 100, wrap: false)
        XCTAssertEqual(q.x, 100, accuracy: 1e-6)
        XCTAssertEqual(q.y, 0, accuracy: 1e-6)
    }

    func testOpenPathPingPongsInsteadOfTeleporting() throws {
        let layers = try compile("""
        {"seed":2,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"path","duration":2000,"closed":false,"curve":"linear",
                    "points":[{"x":0,"y":0.5},{"x":1,"y":0.5}]}}]}
        """)
        var e = layers[0].entities[0]
        e.path?.phase = 0
        let size = CGSize(width: 100, height: 100)
        let start = SceneMotion.position(of: e, at: 0, in: size, dim: 100, wrap: false)
        let mid = SceneMotion.position(of: e, at: 1, in: size, dim: 100, wrap: false)
        let end = SceneMotion.position(of: e, at: 2, in: size, dim: 100, wrap: false)
        XCTAssertEqual(start.x, 0, accuracy: 1e-6)
        XCTAssertEqual(mid.x, 100, accuracy: 1e-6, "reaches the far end at the half-cycle")
        XCTAssertEqual(end.x, 0, accuracy: 1e-6, "and comes back")
    }

    // MARK: - motion: warp

    func testWarpMotionDecodesAndFliesAtTheViewer() throws {
        let layers = try compile("""
        {"seed":5,"layers":[{"count":3,"sprite":{"kind":"circle","radius":[0.005,0.01],"color":"#fff"},
          "motion":{"type":"warp","speed":[0.2,0.4]}}]}
        """)
        let e = layers[0].entities[0]
        XCTAssertEqual(e.motionType, "warp", "warp fell back to drift")
        let w = try XCTUnwrap(e.warp)
        XCTAssertTrue((SceneMotion.warpNear...1).contains(w.z0))

        // Depth decreases with time (approaching), and scale grows as 1/z.
        let z0 = SceneMotion.warpDepth(w, at: 0)
        let z1 = SceneMotion.warpDepth(w, at: 0.1)
        XCTAssertLessThan(z1, z0)
        XCTAssertGreaterThan(SceneMotion.growScale(of: e, at: 0.1),
                             SceneMotion.growScale(of: e, at: 0))
    }

    func testWarpFadesInFromTheFarPlane() throws {
        var e = CompiledEntity(x: 0.5, y: 0.5, vx: 0, vy: 0, size: 0.01, aspect: 1,
                               color: "#fff", alpha: 1, phase: 0, spinSpeed: 0, spinAngle: 0)
        e.motionType = "warp"
        // z0 just under the far plane: depth wraps on the half-open range
        // [near, 1), so z0 == 1 would land ON the near plane instead.
        e.warp = WarpParams(ux: 0.5, uy: 0, z0: 0.99, vz: 0.5, cx: 0.5, cy: 0.5)
        let layer = CompiledLayer(entities: [e], sprite: .unknown, units: .viewport,
                                  blend: nil, wrap: false, pulse: nil, life: nil)
        // Barely visible at the far plane, full strength once it has closed
        // 20% of the depth — the ramp that masks the respawn pop.
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: layer, at: 0), 0.05, accuracy: 1e-9)
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: layer, at: 0.2), 0.55, accuracy: 1e-9)
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: layer, at: 0.4), 1, accuracy: 1e-9)
    }

    // MARK: - ghosting

    func testGhostingDecodes() throws {
        let spec = try JSONDecoder().decode(
            SpecSubset.self,
            from: Data(##"{"seed":1,"ghosting":0.35,"layers":[]}"##.utf8))
        XCTAssertEqual(spec.ghosting, 0.35)
    }
}

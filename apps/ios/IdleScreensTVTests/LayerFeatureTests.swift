import XCTest
@testable import IdleScreensTV

/// The remaining layer-level SaverSpec features: weighted palettes, sparse
/// `emit` events, `trail` afterglow and `links`. Pinned against
/// packages/schema (simulate.ts / compile.ts).
final class LayerFeatureTests: XCTestCase {

    private func compile(_ json: String) throws -> [CompiledLayer] {
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        return spec.compile(seed: spec.seed ?? 1)
    }

    // MARK: - colorWeights

    func testWeightedIndexPartitionsTheUnitInterval() {
        // 10% / 90%: the boundary sits at 0.1, not the midpoint.
        XCTAssertEqual(SpecSubset.Layer.weightedIndex(0.0, [1, 9]), 0)
        XCTAssertEqual(SpecSubset.Layer.weightedIndex(0.09, [1, 9]), 0)
        XCTAssertEqual(SpecSubset.Layer.weightedIndex(0.11, [1, 9]), 1)
        XCTAssertEqual(SpecSubset.Layer.weightedIndex(0.999, [1, 9]), 1)
        XCTAssertEqual(SpecSubset.Layer.weightedIndex(0.5, [0, 0]), 0, "no divide by zero")
    }

    func testLopsidedPaletteActuallyLandsLopsided() throws {
        // An unweighted pick spreads a deliberately lopsided palette evenly,
        // which is a different picture from the one that was published.
        let layers = try compile(##"""
        {"seed":12,"layers":[{"count":200,
          "sprite":{"kind":"circle","radius":[0.01,0.01],
                    "color":"#ff0000","colors":["#ff0000","#00ff00"],
                    "colorWeights":[19,1]},
          "motion":{"type":"static"}}]}
        """##)
        let reds = layers[0].entities.filter { $0.color == "#ff0000" }.count
        XCTAssertGreaterThan(reds, 170, "95% of the palette weight should be red")
        XCTAssertLessThan(reds, 200, "but not all of it")
    }

    func testWeightsDoNotDisturbTheStream() throws {
        // Weighted and unweighted picks both consume exactly one draw, so
        // sizes and alphas must be untouched.
        let body = ##"{"count":30,"sprite":{"kind":"circle","radius":[0.01,0.04],"color":"#f00","colors":["#f00","#0f0"]"##
        let plain = try compile("{\"seed\":5,\"layers\":[\(body)},\"alpha\":[0.1,0.9],\"motion\":{\"type\":\"static\"}}]}")
        let weighted = try compile("{\"seed\":5,\"layers\":[\(body),\"colorWeights\":[3,1]},\"alpha\":[0.1,0.9],\"motion\":{\"type\":\"static\"}}]}")
        XCTAssertEqual(plain[0].entities.map(\.size), weighted[0].entities.map(\.size))
        XCTAssertEqual(plain[0].entities.map(\.alpha), weighted[0].entities.map(\.alpha))
    }

    // MARK: - emit

    func testEmitWindowIsSparseAndShaped() {
        let e = EmitParams(every: 1000, life: 200, phase: 0, growFrom: 1, growTo: 1)
        XCTAssertNil(e.window(at: 0.5), "off screen between appearances")
        XCTAssertEqual(e.window(at: 0.1) ?? -1, 0.5, accuracy: 1e-9, "halfway through its life")
        XCTAssertEqual(e.window(at: 1.05) ?? -1, 0.25, accuracy: 1e-9, "and again next period")
        // Envelope: silent at the edges, full at the attack peak.
        XCTAssertEqual(EmitParams.envelope(0), 0, accuracy: 1e-9)
        XCTAssertEqual(EmitParams.envelope(0.25), 1, accuracy: 1e-9)
        XCTAssertEqual(EmitParams.envelope(1), 0, accuracy: 1e-9)
    }

    func testEmitPhasesStaggerAcrossEntities() throws {
        let layers = try compile(##"""
        {"seed":7,"layers":[{"count":4,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"static"},"emit":{"every":8000,"life":2000,"jitter":0}}]}
        """##)
        let phases = layers[0].entities.compactMap { $0.emit?.phase }
        XCTAssertEqual(phases.count, 4)
        // jitter 0 is a metronome: evenly spread across the period.
        XCTAssertEqual(phases, [0, 2000, 4000, 6000])
        XCTAssertEqual(layers[0].entities[0].emit?.life, 2000)
    }

    func testEmitDoesNotDisturbTheStream() throws {
        // Emit timing comes from the index, never the seeded stream.
        let body = ##"{"count":8,"sprite":{"kind":"circle","radius":[0.01,0.05],"color":"#fff"},"alpha":[0.2,0.8],"motion":{"type":"static"}"##
        let plain = try compile("{\"seed\":3,\"layers\":[\(body)}]}")
        let emitting = try compile("{\"seed\":3,\"layers\":[\(body),\"emit\":{\"every\":5000,\"life\":900}}]}")
        XCTAssertEqual(plain[0].entities.map(\.size), emitting[0].entities.map(\.size))
        XCTAssertEqual(plain[0].entities.map(\.alpha), emitting[0].entities.map(\.alpha))
    }

    func testEmitSilencesTheEntityBetweenAppearances() throws {
        let layers = try compile(##"""
        {"seed":7,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"static"},"emit":{"every":4000,"life":1000,"jitter":0}}]}
        """##)
        let layer = layers[0]
        let e = layer.entities[0]
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: layer, at: 2.0), 0,
                       "an emitting entity must be absent, not dimmed, off-window")
        XCTAssertGreaterThan(SceneMotion.pulsedAlpha(of: e, layer: layer, at: 0.25), 0.9)
    }

    func testEmitGrowScalesAcrossTheAppearance() throws {
        let layers = try compile(##"""
        {"seed":7,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"static"},"emit":{"every":4000,"life":2000,"jitter":0,"grow":[0.5,1.5]}}]}
        """##)
        let e = layers[0].entities[0]
        XCTAssertEqual(SceneMotion.growScale(of: e, at: 0), 0.5, accuracy: 1e-6)
        XCTAssertEqual(SceneMotion.growScale(of: e, at: 1.0), 1.0, accuracy: 1e-6)
    }

    // MARK: - trail / links decode

    func testTrailAndLinksReachTheCompiledLayer() throws {
        let layers = try compile(##"""
        {"seed":8,"layers":[{"count":3,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},
          "motion":{"type":"drift","speed":[0.01,0.02]},
          "trail":{"length":600,"fade":0.8},
          "links":{"k":2,"maxDist":0.3,"mode":"chain","alpha":0.4,"falloff":true}}]}
        """##)
        XCTAssertEqual(layers[0].trail?.length, 600)
        XCTAssertEqual(layers[0].trail?.fade, 0.8)
        XCTAssertEqual(layers[0].links?.k, 2)
        XCTAssertEqual(layers[0].links?.mode, "chain")
        XCTAssertEqual(layers[0].links?.falloff, true)
    }

    func testUnknownLayerFieldsStillDecode() throws {
        // The custom Layer decoder must stay lenient: a field the renderer
        // does not know yet must never fail the layer (and with it the spec).
        let layers = try compile(##"""
        {"seed":8,"layers":[{"count":2,"id":"x","label":"y","type":"z","clock":{"phase":0.5},
          "sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff","futureField":true},
          "motion":{"type":"drift","speed":[0.01,0.02],"ease":{"type":"settle","tau":300}}}]}
        """##)
        XCTAssertEqual(layers.count, 1)
        XCTAssertEqual(layers[0].entities.count, 2)
    }
}

/// Differential checks against packages/schema/src/simulate.ts for motions
/// that were already "supported" but did not match the web.
final class DriftParityTests: XCTestCase {

    private func entity(vx: Double = 0, vy: Double = 0, bob: Double = 0,
                        size: Double = 0.05) -> CompiledEntity {
        var e = CompiledEntity(x: 0.5, y: 0.5, vx: vx, vy: vy, size: size, aspect: 1,
                               color: "#fff", alpha: 1, phase: 0, spinSpeed: 0, spinAngle: 0)
        e.motionType = "drift"
        e.bob = bob
        return e
    }

    private let size = CGSize(width: 1000, height: 1000)

    func testBobOffsetsVerticallyNotHorizontally() {
        // The web adds `bob` to Y. Applying it to X made every drifting layer
        // in the catalog sway the wrong way.
        let e = entity(bob: 0.1)
        let p = SceneMotion.position(of: e, at: 0.25, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(p.x, 500, accuracy: 1e-6, "x must not carry the bob")
        XCTAssertNotEqual(p.y, 500, "y must")
    }

    func testBobUsesTheDriftRateNotTheRiseRate() {
        // sin(t/500) with t in MILLISECONDS — an angular rate, so the full
        // cycle is 2π·500ms. Drift is 500; rise is the slower 700, and using
        // rise's rate here made every drifting layer breathe at the wrong
        // tempo.
        let e = entity(bob: 0.1)
        let quarter = Double.pi / 2 * 500 / 1000        // seconds to the peak
        let peak = SceneMotion.position(of: e, at: quarter, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(peak.y, 600, accuracy: 1e-6)
        let half = Double.pi * 500 / 1000
        let zero = SceneMotion.position(of: e, at: half, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(zero.y, 500, accuracy: 1e-6, "half cycle returns to centre")
        // At the same instant the 700-rate would NOT be back at centre.
        XCTAssertNotEqual(sin(half * 1000 / 700), 0, accuracy: 1e-3)
    }

    func testWrapCarriesASpriteMarginSoItGlidesOffAndBack() {
        // Wrap range is [-m, w+m]: a sprite leaves the frame completely before
        // reappearing, instead of snapping at the border.
        let e = entity(vx: 1, size: 0.05)          // m = 50px
        // Travels 1000px/s; at t=1.0 the raw x is 1500 → wraps into [-50,1050].
        let p = SceneMotion.position(of: e, at: 1.0, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(p.x, 1500 - 1100, accuracy: 1e-6)
        // Just past the right edge it is still on its way out, not re-entered.
        let leaving = SceneMotion.position(of: e, at: 0.52, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(leaving.x, 1020, accuracy: 1e-6)
    }

    func testStationaryAxisDoesNotWrap() {
        // y wraps only when the entity actually moves vertically.
        var e = entity(vx: 1)
        e.y = 1.4                                   // parked below the frame
        let p = SceneMotion.position(of: e, at: 0, in: size, dim: 1000, wrap: true)
        XCTAssertEqual(p.y, 1400, accuracy: 1e-6, "a still axis keeps its position")
    }

    func testWrapDisabledLetsTheEntityLeaveInsteadOfPinningIt() {
        // Clamping parked every escaped sprite in a line along the border.
        let e = entity(vx: 1)
        let p = SceneMotion.position(of: e, at: 3, in: size, dim: 1000, wrap: false)
        XCTAssertEqual(p.x, 3500, accuracy: 1e-6, "gone, not stuck at the edge")
    }
}

/// Alpha is one model shared by both renderers. It used to be computed inline
/// in the Canvas tier, which skipped everything else SceneMotion knows.
final class AlphaModelTests: XCTestCase {

    private func layer(pulse: SpecSubset.Pulse?, entity: CompiledEntity) -> CompiledLayer {
        CompiledLayer(entities: [entity], sprite: .unknown, units: .viewport,
                      blend: nil, wrap: true, pulse: pulse, life: nil,
                      key: nil, orbitParentKey: nil, trail: nil, links: nil)
    }

    private func base(alpha: Double) -> CompiledEntity {
        CompiledEntity(x: 0.5, y: 0.5, vx: 0, vy: 0, size: 0.01, aspect: 1,
                       color: "#fff", alpha: alpha, phase: 0, spinSpeed: 0, spinAngle: 0)
    }

    func testPulseIsAdditiveNotAPercentage() {
        // Web: alpha + amp·sin. At alpha 0.5 / amp 0.4 the swing is 0.1…0.9;
        // multiplying by (1 + amp·sin) would only reach 0.3…0.7.
        let e = base(alpha: 0.5)
        let l = layer(pulse: SpecSubset.Pulse(amp: 0.4, period: 1000), entity: e)
        let quarter = 0.25   // sin = 1
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: l, at: quarter), 0.9, accuracy: 1e-9)
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: l, at: 0.75), 0.1, accuracy: 1e-9)
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: l, at: 0.5), 0.5, accuracy: 1e-9)
    }

    func testPulseStaysClamped() {
        let e = base(alpha: 0.9)
        let l = layer(pulse: SpecSubset.Pulse(amp: 0.5, period: 1000), entity: e)
        let a = SceneMotion.pulsedAlpha(of: e, layer: l, at: 0.25)
        XCTAssertLessThanOrEqual(a, 1)
        XCTAssertGreaterThanOrEqual(SceneMotion.pulsedAlpha(of: e, layer: l, at: 0.75), 0)
    }

    func testEmitSilenceSurvivesAPulsingLayer() {
        // The renderer asks for ONE alpha; an emitting entity must be absent
        // off-window even when the layer also pulses.
        var e = base(alpha: 1)
        e.emit = EmitParams(every: 4000, life: 1000, phase: 0, growFrom: 1, growTo: 1)
        let l = layer(pulse: SpecSubset.Pulse(amp: 0.3, period: 900), entity: e)
        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: l, at: 2.5), 0)
        XCTAssertGreaterThan(SceneMotion.pulsedAlpha(of: e, layer: l, at: 0.25), 0)
    }
}

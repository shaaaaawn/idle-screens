import XCTest
@testable import IdleScreensTV

final class ClassicSaverTests: XCTestCase {

    // MARK: - Routing

    func testSupportedIds() {
        XCTAssertEqual(ClassicSaverKind.supported(id: "warp"), .warp)
        XCTAssertEqual(ClassicSaverKind.supported(id: "rainstorm"), .rainstorm)
        XCTAssertNil(ClassicSaverKind.supported(id: "metaquarium"), "unported savers stay on thumbs")
        XCTAssertNil(ClassicSaverKind.supported(id: nil))
    }

    // MARK: - Tier gating

    @MainActor
    func testHardwareTierIgnoresThumbFailure() {
        // Regression: warp channels ship broken (black) server thumbs, so the
        // thumb stream fails fast and effectiveTier collapses to t0. The
        // classic ports are fully local — a dead thumb must not veto them.
        let app = TVAppState()
        app.reportThumbFailure()
        XCTAssertEqual(app.effectiveTier, .t0, "thumb ladder unchanged")
        XCTAssertEqual(app.hardwareTier, app.tierOverride ?? app.detectedTier,
                       "classic gate sees raw hardware capability")
    }

    // MARK: - Warp

    func testWarpFieldIsDeterministicPerSeed() {
        let a = WarpField(seed: 42, count: 32)
        let b = WarpField(seed: 42, count: 32)
        XCTAssertEqual(a.stars, b.stars)
        let c = WarpField(seed: 43, count: 32)
        XCTAssertNotEqual(a.stars, c.stars)
    }

    func testWarpStarInvariants() {
        let field = WarpField(seed: 7, count: 200)
        for s in field.stars {
            XCTAssertTrue((-1...1).contains(s.x))
            XCTAssertTrue((-1...1).contains(s.y))
            XCTAssertTrue((0..<1).contains(s.phase))
            // The flash-safety promise: shimmer periods never dip under 800ms.
            XCTAssertGreaterThanOrEqual(s.twinklePeriod, 800)
            XCTAssertLessThanOrEqual(s.twinklePeriod, 1800)
        }
    }

    func testWarpProgressIsClosedForm() {
        // Same (phase, t) always lands at the same progress; a full period
        // wraps back exactly — the web's frac(phase + t*rate) contract.
        let rate = WarpField.baseRate
        let p1 = WarpField.progress(phase: 0.25, t: 1000, rate: rate)
        let p2 = WarpField.progress(phase: 0.25, t: 1000, rate: rate)
        XCTAssertEqual(p1, p2)
        let period = 1 / rate
        let wrapped = WarpField.progress(phase: 0.25, t: 1000 + period, rate: rate)
        XCTAssertEqual(p1, wrapped, accuracy: 1e-9)
        XCTAssertTrue((0..<1).contains(p1))
    }

    func testWarpFadeEnvelopeHidesSpawnAndRecycle() {
        XCTAssertEqual(WarpField.fadeEnvelope(0), 0, "spawn must be invisible")
        XCTAssertEqual(WarpField.fadeEnvelope(0.9999), 0, accuracy: 0.001,
                       "recycle must be invisible")
        XCTAssertEqual(WarpField.fadeEnvelope(0.5), 1, "mid-travel fully visible")
    }

    // MARK: - Rainstorm

    func testRainFieldIsDeterministicPerSeed() {
        let a = RainField(seed: 9)
        let b = RainField(seed: 9)
        XCTAssertEqual(a.layers.count, 3)
        XCTAssertEqual(a.layers.map(\.drops.count), b.layers.map(\.drops.count))
        XCTAssertEqual(a.layers[0].drops[0].y0, b.layers[0].drops[0].y0)
    }

    func testRainDropPositionsStayInWrapBounds() {
        let field = RainField(seed: 3)
        let layer = field.layers[0]
        for t in stride(from: 0.0, through: 60_000, by: 700) {
            let p = RainField.position(of: layer.drops[0], slant: layer.slant,
                                       t: t, width: 1920, height: 1080)
            XCTAssertGreaterThanOrEqual(p.x, -40)
            XCTAssertLessThanOrEqual(p.x, 1920 + 40)
            // y wraps over the fall span: from just above the top edge to
            // below the bottom (the streak finishes falling off-screen).
            XCTAssertGreaterThanOrEqual(p.y, -layer.drops[0].len - 1)
            XCTAssertLessThanOrEqual(p.y, 1080 + layer.drops[0].len * 2 + 1080 * 0.2)
        }
    }

    func testFlashPulseIsBriefAndBounded() {
        // Quiet almost all period, a single bounded pulse in the last 140ms.
        XCTAssertEqual(RainField.flashLevel(at: 0), 0)
        XCTAssertEqual(RainField.flashLevel(at: 4000), 0)
        XCTAssertEqual(RainField.flashLevel(at: 7859), 0)
        let peak = RainField.flashLevel(at: 8000 - 140 + 56) // k = 0.4 → peak
        XCTAssertEqual(peak, 1, accuracy: 1e-9)
        for t in stride(from: 7860.0, through: 8000, by: 5) {
            let level = RainField.flashLevel(at: t)
            XCTAssertTrue((0...1).contains(level))
        }
        // Same phase every period — closed-form.
        XCTAssertEqual(RainField.flashLevel(at: 7900),
                       RainField.flashLevel(at: 7900 + 8000), accuracy: 1e-9)
    }
}

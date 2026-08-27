import XCTest
@testable import IdleScreensTV

final class ClassicSaverTests: XCTestCase {

    // MARK: - Routing

    func testSupportedIds() {
        XCTAssertEqual(ClassicSaverKind.supported(id: "warp"), .warp)
        XCTAssertEqual(ClassicSaverKind.supported(id: "rainstorm"), .rainstorm)
        XCTAssertEqual(ClassicSaverKind.supported(id: "metaquarium"), .metaquarium, "the 2D tank is a native port now")
        XCTAssertNil(ClassicSaverKind.supported(id: nil))
    }

    // MARK: - Seeding

    func testChannelSeedIsStableAndDistinct() {
        // Poster and fullscreen derive the field from the same channel id,
        // so they must agree — and differ between channels.
        let a = ClassicSaverKind.seed(forChannel: "coral-tide-f2")
        XCTAssertEqual(a, ClassicSaverKind.seed(forChannel: "coral-tide-f2"))
        XCTAssertNotEqual(a, ClassicSaverKind.seed(forChannel: "wild-meadow-88"))
    }

    // MARK: - Tier gating

    @MainActor
    func testClassicRendersOnPre4KHardware() {
        // The pre-4K boxes (t2) are the floor these ports exist for: line
        // strokes are affordable there even though the schema renderer's
        // per-entity gradients are not.
        let app = TVAppState()
        app.tierOverride = .t2
        XCTAssertEqual(app.classicRenderTier, .t2)
        app.tierOverride = .t3
        XCTAssertEqual(app.classicRenderTier, .t3)
        // Thumb-stream tiers keep the stream.
        app.tierOverride = .t1
        XCTAssertNil(app.classicRenderTier)
        app.tierOverride = .t0
        XCTAssertNil(app.classicRenderTier)
    }

    @MainActor
    func testWatchdogDowngradeDropsClassicRenderer() {
        let app = TVAppState()
        app.tierOverride = .t2
        XCTAssertNotNil(app.classicRenderTier)
        app.watchdogDidTrigger()
        XCTAssertNil(app.classicRenderTier, "a janking port must yield to the thumb stream")
    }

    func testTierQualityLadder() {
        // t2 thins the field rather than dropping the saver.
        XCTAssertEqual(WarpField.starCount(for: .t3), WarpField.density)
        XCTAssertLessThan(WarpField.starCount(for: .t2), WarpField.density)
        XCTAssertEqual(RainField.scale(for: .t3), 1)
        XCTAssertLessThan(RainField.scale(for: .t2), 1)
        // Thinner field, longer streaks — same stroke count, fuller read.
        XCTAssertGreaterThan(WarpField.streak(for: .t2), WarpField.streak(for: .t3))
        // Thinning keeps star identity: the survivors are the same stars.
        let full = WarpField(seed: 5, count: WarpField.density)
        let thin = WarpField(seed: 5, count: WarpField.starCount(for: .t2))
        XCTAssertEqual(Array(full.stars.prefix(thin.stars.count)), thin.stars)
    }

    // MARK: - Poster routing

    func testClassicChannelDecodesSaverIdForPosters() throws {
        let json = #"{"id":"coral-tide-f2","label":"coral tide","resolvedSpec":{"id":"warp"}}"#
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(json.utf8))
        XCTAssertNil(channel.spec, "classic docs carry no layers")
        XCTAssertEqual(channel.classicSaverId, "warp")
        XCTAssertEqual(ClassicSaverKind.supported(id: channel.classicSaverId), .warp)
    }

    func testSchemaChannelHasNoClassicSaverId() throws {
        let json = """
        {"id":"lanterns","resolvedSpec":{"seed":88,"layers":[
          {"count":4,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},
           "motion":{"type":"drift","speed":[0.001,0.002]}}]}}
        """
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(json.utf8))
        XCTAssertNotNil(channel.spec)
        XCTAssertNil(channel.classicSaverId)
    }

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

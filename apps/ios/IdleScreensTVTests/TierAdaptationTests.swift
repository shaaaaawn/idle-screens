import XCTest
@testable import IdleScreensTV

final class TierAdaptationTests: XCTestCase {

    func testTierOrdering() {
        XCTAssertEqual(CapabilityTier.lower(of: .t3, .t2), .t2)
        XCTAssertEqual(CapabilityTier.lower(of: .t1, .t3), .t1)
        XCTAssertTrue(CapabilityTier.t0.isLowerOrEqual(to: .t3))
        XCTAssertFalse(CapabilityTier.t3.isLowerOrEqual(to: .t2))
    }

    func testCapStoreLearnsAndOnlyTightens() {
        let defaults = UserDefaults(suiteName: "tier-cap-tests")!
        defaults.removePersistentDomain(forName: "tier-cap-tests")
        let store = TierCapStore(defaults: defaults)

        XCTAssertNil(store.cap(for: "heavy"))
        store.record(.t2, for: "heavy")
        XCTAssertEqual(store.cap(for: "heavy"), .t2)
        // Tighten sticks.
        store.record(.t1, for: "heavy")
        XCTAssertEqual(store.cap(for: "heavy"), .t1)
        // Loosening is ignored — caps only clear explicitly.
        store.record(.t3, for: "heavy")
        XCTAssertEqual(store.cap(for: "heavy"), .t1)
        store.clearAll()
        XCTAssertNil(store.cap(for: "heavy"))
    }

    func testPrecapFlagsHeavyScenes() throws {
        // 4 layers × 300 soft circles = 1200 entities, all radial-gradient —
        // exactly what grinds the Canvas tier.
        let json = """
        {"units":"px","layers":[
          {"count":300,"sprite":{"kind":"circle","radius":[40,90],"color":"#8B7CFF","soft":true},"motion":{"type":"drift","speed":[2,6]}},
          {"count":300,"sprite":{"kind":"circle","radius":[40,90],"color":"#5EEAD4","soft":true},"motion":{"type":"drift","speed":[2,6]}},
          {"count":300,"sprite":{"kind":"circle","radius":[40,90],"color":"#FFD60A","soft":true},"motion":{"type":"drift","speed":[2,6]}},
          {"count":300,"sprite":{"kind":"circle","radius":[40,90],"color":"#ffffff","soft":true},"motion":{"type":"drift","speed":[2,6]}}]}
        """
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        let layers = spec.compile(seed: 7)
        XCTAssertEqual(SceneComplexity.precap(for: layers), .t2)
    }

    func testPrecapPassesNormalScenes() {
        let layers = FallbackSceneView.ambientSpec(seed: "test").compile(seed: 1)
        XCTAssertNil(SceneComplexity.precap(for: layers))
    }

    func testFallbackSceneAlwaysRenderable() {
        let spec = FallbackSceneView.ambientSpec(seed: "any-channel")
        let layers = spec.compile(seed: spec.seed ?? 1)
        XCTAssertFalse(layers.isEmpty)
        XCTAssertEqual(SceneVisibility.verdict(layers: layers, background: spec.background), .visible)
    }
}

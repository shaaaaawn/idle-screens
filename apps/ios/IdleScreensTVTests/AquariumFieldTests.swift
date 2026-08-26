import XCTest
@testable import IdleScreensTV

final class AquariumFieldTests: XCTestCase {
    func testSameSeedSameTank() {
        let a = AquariumField(seed: 42, tier: .t3)
        let b = AquariumField(seed: 42, tier: .t3)
        XCTAssertEqual(a.fish.count, b.fish.count)
        for (fa, fb) in zip(a.fish, b.fish) {
            XCTAssertEqual(fa.icon, fb.icon)
            XCTAssertEqual(fa.lane, fb.lane, accuracy: 1e-12)
            XCTAssertEqual(fa.period, fb.period, accuracy: 1e-9)
        }
    }

    func testDifferentSeedsDifferentTanks() {
        let a = AquariumField(seed: 1, tier: .t3)
        let b = AquariumField(seed: 2, tier: .t3)
        XCTAssertNotEqual(a.fish.map(\.lane), b.fish.map(\.lane))
    }

    func testDepthStratification() {
        // Every third of the depth range is populated — the parallax promise.
        let field = AquariumField(seed: 7, tier: .t3)
        let depths = field.fish.map(\.depth)
        XCTAssertTrue(depths.contains { $0 < 1.0 / 3 })
        XCTAssertTrue(depths.contains { $0 >= 1.0 / 3 && $0 < 2.0 / 3 })
        XCTAssertTrue(depths.contains { $0 >= 2.0 / 3 })
        // Sorted far-to-near so near fish draw on top.
        XCTAssertEqual(depths, depths.sorted())
    }

    func testTierBudgets() {
        XCTAssertLessThan(AquariumField(seed: 3, tier: .t2).fish.count,
                          AquariumField(seed: 3, tier: .t3).fish.count)
    }

    func testCastNamesMatchBundledImagesets() {
        // Every cast entry must resolve from the asset catalog, or a fish
        // silently never draws.
        for name in AquariumField.cast {
            XCTAssertNotNil(UIImage(named: name), name)
        }
    }

    func testEveryFishStaysInLaneBand() {
        let field = AquariumField(seed: 99, tier: .t3)
        for f in field.fish {
            XCTAssertGreaterThanOrEqual(f.lane - f.bobAmp, 0.05)
            XCTAssertLessThanOrEqual(f.lane + f.bobAmp, 0.86)
        }
    }
}

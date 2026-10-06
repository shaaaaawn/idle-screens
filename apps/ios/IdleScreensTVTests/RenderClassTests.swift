import XCTest
@testable import IdleScreensTV

/// Hardware we cannot buy yet has to be handled by rule, not by name.
final class RenderClassTests: XCTestCase {

    private let fourGB: UInt64 = 4_000_000_000
    private let eightGB: UInt64 = 8_000_000_000

    func testKnownBoxesMapToTheirClass() {
        // A8 / A10X — the pre-4K boxes the sprite tier exists for.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV5,3", memoryBytes: fourGB), .legacy)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV6,2", memoryBytes: fourGB), .legacy)
        // A12 / A15 — the generations today's ceilings were tuned on.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV11,1", memoryBytes: fourGB), .standard)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV14,1", memoryBytes: fourGB), .standard)
    }

    func testUnreleasedHardwareDefaultsUpNotDown() {
        // The whole point: a box that does not exist when this ships must get
        // the HIGHEST budget, not the lowest. Guessing downward would hand
        // the best silicon the worst renderer.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV15,1", memoryBytes: eightGB), .high)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV16,3", memoryBytes: fourGB), .high)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV42,9", memoryBytes: fourGB), .high)
        // And it still lands on the Canvas tier.
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV15,1"), .t3)
        XCTAssertEqual(CapabilityDetector.tier(forMachine: "AppleTV42,9"), .t3)
    }

    func testMemoryIsASecondOpinionOnAnOldLookingNumber() {
        // New silicon can ship under a familiar-looking identifier; RAM well
        // past any shipped A12–A15 box gives it away.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV14,5", memoryBytes: eightGB), .high)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV14,5", memoryBytes: fourGB), .standard)
        // RAM never promotes a pre-4K box — those lack the GPU, not the memory.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "AppleTV6,2", memoryBytes: eightGB), .legacy)
    }

    func testSimulatorsAreTreatedAsCurrentHardware() {
        // A simulator runs on the Mac's silicon; reporting `high` there would
        // make every local QA pass measure a machine nobody owns.
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "arm64", memoryBytes: eightGB), .standard)
        XCTAssertEqual(CapabilityDetector.renderClass(forMachine: "x86_64", memoryBytes: eightGB), .standard)
    }

    func testCeilingsRiseWithTheClassAndNeverFall() {
        let classes: [RenderClass] = [.legacy, .standard, .high]
        for (lower, higher) in zip(classes, classes.dropFirst()) {
            XCTAssertLessThan(lower.maxCanvasEntities, higher.maxCanvasEntities)
            XCTAssertLessThan(lower.maxCanvasSoftCircles, higher.maxCanvasSoftCircles)
            XCTAssertLessThan(lower.fullscreenEntityBudget, higher.fullscreenEntityBudget)
        }
        // Today's numbers are exactly what the standard class carries, so
        // existing boxes see no change at all from this work.
        XCTAssertEqual(SceneComplexity.maxEntitiesForCanvas, RenderClass.standard.maxCanvasEntities)
        XCTAssertEqual(SceneComplexity.maxSoftCirclesForCanvas, RenderClass.standard.maxCanvasSoftCircles)
    }

    func testARichSceneStaysOnTheCanvasTierOnNewerHardware() {
        // 1200 entities: over the A12-era ceiling, well inside the new one.
        let entity = CompiledEntity(x: 0.5, y: 0.5, vx: 0, vy: 0, size: 0.01, aspect: 1,
                                    color: "#fff", alpha: 1, phase: 0,
                                    spinSpeed: 0, spinAngle: 0)
        let layer = CompiledLayer(entities: Array(repeating: entity, count: 1_200),
                                  sprite: .circle(radius: (0.01, 0.01), color: "#fff",
                                                  colors: ["#fff"], soft: false),
                                  units: .viewport, blend: nil, wrap: true, pulse: nil,
                                  life: nil, key: nil, orbitParentKey: nil,
                                  trail: nil, links: nil)
        XCTAssertEqual(SceneComplexity.precap(for: [layer], renderClass: .standard), .t2,
                       "today's boxes still step down, as before")
        XCTAssertNil(SceneComplexity.precap(for: [layer], renderClass: .high),
                     "newer hardware keeps the full-fidelity renderer")
    }
}

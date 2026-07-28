import XCTest
@testable import IdleScreens

/// A published scene is untrusted input. Without ceilings, one channel with
/// hundreds of dense layers compiles into hundreds of thousands of entities
/// per tile — a memory/CPU kill that reads to the user as "this channel
/// crashes the app".
final class RenderBudgetTests: XCTestCase {
    /// 200 layers × 400 sprites = 80,000 requested.
    private func hostileSpec() -> SpecSubset {
        let layer = """
        {"count":400,"sprite":{"kind":"circle","radius":[0.01,0.02]},"motion":{"type":"drift"}}
        """
        let json = "{\"layers\":[\(Array(repeating: layer, count: 200).joined(separator: ","))]}"
        return try! JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
    }

    func testPreviewBudgetCapsHostileSpec() {
        let compiled = hostileSpec().compile(seed: 1, budget: SpecSubset.Budget.preview)
        let total = compiled.reduce(0) { $0 + $1.entities.count }
        XCTAssertLessThanOrEqual(compiled.count, SpecSubset.Budget.preview.layers)
        XCTAssertLessThanOrEqual(total, SpecSubset.Budget.preview.entities)
        XCTAssertGreaterThan(total, 0, "a capped scene must still render something")
    }

    func testFullscreenBudgetCapsHostileSpec() {
        let compiled = hostileSpec().compile(seed: 1, budget: SpecSubset.Budget.fullscreen)
        let total = compiled.reduce(0) { $0 + $1.entities.count }
        XCTAssertLessThanOrEqual(total, SpecSubset.Budget.fullscreen.entities)
    }

    /// Absurd-but-decodable magnitudes must not produce non-finite geometry
    /// (JSON itself can't carry NaN/∞ — Swift rejects `1e400` at decode — so
    /// the real risk is overflow while compiling, which then reaches
    /// CoreGraphics and can hard-crash the render).
    func testExtremeMagnitudesStayFinite() {
        let json = """
        {"layers":[{"count":5,"sprite":{"kind":"circle","radius":[1e308,1e308]},
        "motion":{"type":"drift","speed":[1e308,1e308]}}]}
        """
        let spec = try! JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        let compiled = spec.compile(seed: 1)
        for layer in compiled {
            for entity in layer.entities {
                XCTAssertTrue(entity.x.isFinite && entity.y.isFinite)
                XCTAssertTrue(entity.vx.isFinite && entity.vy.isFinite)
                XCTAssertTrue(entity.size.isFinite)
                XCTAssertTrue(entity.alpha.isFinite)
            }
        }
    }

    /// An ordinary scene must be untouched by the budget.
    func testNormalSpecIsNotThinned() {
        let json = """
        {"layers":[{"count":40,"sprite":{"kind":"circle","radius":[0.01,0.02]},
        "motion":{"type":"drift"}}]}
        """
        let spec = try! JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        let compiled = spec.compile(seed: 7, budget: SpecSubset.Budget.preview)
        XCTAssertEqual(compiled.first?.entities.count, 40)
    }
}

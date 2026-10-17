import XCTest
@testable import IdleScreensTV

/// The home grid on a box that rasterises on its CPU. Remote swipes lagged on
/// pre-4K Apple TVs: every focus move re-ran the whole grid, crossfaded a
/// 90 pt full-screen blur, and new rows drew two canvases per poster.
@MainActor
final class GalleryLightnessTests: XCTestCase {

    func testPreFourKBoxesGetThinnerPosters() {
        XCTAssertLessThan(RenderClass.legacy.previewEntityBudget, RenderClass.standard.previewEntityBudget)
        XCTAssertEqual(RenderClass.standard.previewEntityBudget, SpecSubset.Budget.preview.entities)
        XCTAssertEqual(RenderClass.high.previewEntityBudget, SpecSubset.Budget.preview.entities)
    }

    func testTheSpriteTierTurnsOnTheLightweightGallery() {
        let key = TVAppState.tierOverrideKey
        let saved = UserDefaults.standard.string(forKey: key)
        defer {
            if let saved { UserDefaults.standard.set(saved, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        let app = TVAppState()
        app.tierOverride = .t2
        XCTAssertTrue(app.lightweightGallery)
        app.tierOverride = .t3
        XCTAssertEqual(app.lightweightGallery, app.renderClass == .legacy,
                       "a canvas-tier box is lightweight only if it is pre-4K hardware")
    }

    func testAThinnedPosterIsTheSameSceneWithFewerEntities() throws {
        let json = ##"{"seed":4,"layers":[{"count":400,"sprite":{"kind":"circle","radius":[0.002,0.004],"color":"#fff"},"motion":{"type":"drift","speed":[0.01,0.02]}},{"count":400,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#f0f"},"motion":{"type":"static"}}]}"##
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        let full = spec.compile(seed: 4, budget: SpecSubset.Budget.preview)
        let thin = spec.compile(seed: 4, budget: (SpecSubset.Budget.preview.layers, RenderClass.legacy.previewEntityBudget))
        XCTAssertEqual(thin.count, full.count, "every layer survives")
        XCTAssertLessThanOrEqual(thin.reduce(0) { $0 + $1.entities.count }, RenderClass.legacy.previewEntityBudget)
        XCTAssertTrue(thin.allSatisfy { !$0.entities.isEmpty }, "no layer thinned to nothing")
    }
}

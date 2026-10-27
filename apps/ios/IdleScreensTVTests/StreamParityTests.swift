import XCTest
@testable import IdleScreensTV

/// Same spec + seed ⇒ same frames on every display: the TV seats and moves
/// every entity exactly where the web does. Pinned to simulate.ts's own
/// output (fixture rounded to 9 significant figures) — `buildEntities` on core's `createRng`, then `positionAt`,
/// `sizeAt`, `alphaAt`, `rotationAt`, `headingAt` and `spriteIndexAt` at four
/// times — over every shipped example and three feature-dense scenes, at
/// 1920×1080. (Before this the TV ran mulberry32 in its own draw order, so no
/// seeded scene matched the web.)
final class StreamParityTests: XCTestCase {

    private struct Scene: Decodable {
        struct Sample: Decodable {
            let t: Double, x: Double, y: Double, size: Double, alpha: Double, rot: Double
            let heading: Double?, variant: Int, flip: Bool
        }
        struct Entity: Decodable { let color: String?; let at: [Sample] }
        let id: String
        let spec: JSONValue
        let seed: Int
        let layers: [[Entity]]
    }

    private func scenes() throws -> [Scene] {
        let url = try XCTUnwrap(Bundle(for: StreamParityTests.self).url(forResource: "stream-golden", withExtension: "json"))
        return try JSONDecoder().decode([Scene].self, from: Data(contentsOf: url))
    }

    func testEveryEntityIsWhereTheWebPutsIt() throws {
        let size = CGSize(width: 1920, height: 1080)
        let all = try scenes()
        XCTAssertGreaterThan(all.count, 25)
        for scene in all {
            let spec = try JSONDecoder().decode(SpecSubset.self, from: JSONEncoder().encode(scene.spec))
            let layers = spec.compile(seed: scene.seed)
            XCTAssertEqual(layers.count, scene.layers.count, scene.id)
            for (li, (layer, golden)) in zip(layers, scene.layers).enumerated() {
                let dim: CGFloat = layer.units == .px ? 1 : 1080
                let label = "\(scene.id) layer \(li)"
                XCTAssertGreaterThanOrEqual(layer.entities.count, golden.count, label)
                let diameter: Bool = {
                    switch layer.sprite { case .circle, .ring, .polygon: return true; default: return false }
                }()
                let variants: Int = {
                    switch layer.sprite {
                    case .emoji(let g): return g.count
                    case .text(let s, _): return s.count
                    default: return 1
                    }
                }()
                for (i, (e, g)) in zip(layer.entities, golden).enumerated() {
                    if let c = g.color { XCTAssertEqual(e.color, c, "\(label) entity \(i) colour") }
                    for s in g.at {
                        let t = s.t / 1000
                        let at = "\(label) entity \(i) at \(s.t)"
                        let p = SceneMotion.position(of: e, at: t, in: size, dim: dim, wrap: layer.wrap)
                        XCTAssertEqual(p.x, s.x, accuracy: 1e-6 * max(1, abs(s.x)), "x \(at)")
                        XCTAssertEqual(p.y, s.y, accuracy: 1e-6 * max(1, abs(s.y)), "y \(at)")
                        let px = e.size * dim * SceneMotion.growScale(of: e, at: t) * (diameter ? 2 : 1)
                        XCTAssertEqual(px, s.size, accuracy: 1e-6 * max(1, s.size), "size \(at)")
                        XCTAssertEqual(SceneMotion.pulsedAlpha(of: e, layer: layer, at: t), s.alpha, accuracy: 1e-9, "alpha \(at)")
                        XCTAssertEqual(SceneMotion.rotationDegrees(of: e, at: t) * .pi / 180, s.rot, accuracy: 1e-8 * max(1, abs(s.rot)), "rotation \(at)")
                        let h = SceneMotion.heading(of: e, at: t, in: size, dim: dim, wrap: layer.wrap)
                        XCTAssertEqual(h == nil, s.heading == nil, "heading presence \(at)")
                        if let h, let w = s.heading { XCTAssertEqual(h, w, accuracy: 1e-6, "heading \(at)") }
                        XCTAssertEqual(SceneMotion.variantIndex(of: e, at: t, variants: variants), s.variant, "variant \(at)")
                    }
                }
            }
        }
    }
}

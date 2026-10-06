import SpriteKit
import SwiftUI
import XCTest
@testable import IdleScreensTV

/// The renderers had no coverage at all: every other suite stops at the
/// compiled scene, so a crash or a blank frame in the code that actually
/// paints could only be found on a television. These draw real frames
/// headlessly — every sprite kind, every layer feature, both GPU tiers —
/// and assert that ink landed.
@MainActor
final class RenderSmokeTests: XCTestCase {

    // MARK: - Fixtures

    /// One layer per sprite kind, plus the layer features that have their
    /// own draw paths (trail, links, emit, life, orbit-parent, warp, path).
    static let kitchenSink = ##"""
    {"seed":11,"ghosting":0.4,
     "background":{"type":"gradient","stops":[{"at":0,"color":"#0a1230"},{"at":1,"color":"#301040"}],"drift":{"amp":0.2,"period":9000},
                   "band":{"y":0.6,"height":0.2,"color":"#ffffff","alpha":0.2}},
     "layers":[
      {"count":12,"sprite":{"kind":"circle","radius":[0.01,0.03],"color":"#ffd27a","soft":true},
       "blend":"lighter","alpha":[0.4,0.9],"pulse":{"amp":0.2,"period":2000},
       "motion":{"type":"drift","speed":[0.01,0.03]},
       "trail":{"length":600,"fade":0.8},
       "links":{"k":2,"maxDist":0.4,"mode":"chain","alpha":0.4,"falloff":true}},
      {"count":4,"sprite":{"kind":"ring","radius":[0.03,0.05],"color":"#7ad0ff"},
       "motion":{"type":"static"},"emit":{"every":4000,"life":2000,"jitter":0,"grow":[0.5,1.5]}},
      {"count":4,"sprite":{"kind":"rect","width":[0.02,0.05],"color":"#ff7a9a"},
       "rotate":[0,90],"motion":{"type":"drift","speed":[0.01,0.02]},
       "life":{"enter":0,"fadeIn":1000,"exit":60000,"fadeOut":1000}},
      {"count":20,"sprite":{"kind":"streak","length":[0.02,0.05],"color":"#ffffff"},
       "motion":{"type":"warp","speed":[0.2,0.4]}},
      {"count":3,"sprite":{"kind":"emoji","glyphs":["✦","🌙"]},"motion":{"type":"drift","speed":[0.01,0.02]}},
      {"count":2,"sprite":{"kind":"text","strings":["idle","screens"],"color":"#ffffff"},
       "motion":{"type":"static"}},
      {"count":1,"sprite":{"kind":"textBlock","text":"a quiet line of type","fontSize":0.04,"color":"#ffffff"},
       "motion":{"type":"static"}},
      {"key":"hub","count":1,"sprite":{"kind":"polygon","radius":[0.05,0.05],"color":"#9affc0","sides":6},
       "motion":{"type":"orbit","center":{"x":0.5,"y":0.5},"radius":[0.2,0.2],"period":[8000,8000]}},
      {"count":3,"sprite":{"kind":"stroke","length":[0.06,0.1],"points":[[-1,0],[0,0.4],[1,0]],"color":"#ffffff","taper":true},
       "motion":{"type":"orbit","center":{"layer":"hub"},"radius":[0.08,0.08],"period":[3000,3000]}},
      {"count":1,"sprite":{"kind":"bar","values":[1,3,2,5],"length":0.3,"thickness":0.02,"color":"#ffcc00"},
       "motion":{"type":"static"}}
     ]}
    """##

    private func scene(_ json: String = RenderSmokeTests.kitchenSink) throws
        -> (layers: [CompiledLayer], spec: SpecSubset) {
        let spec = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
        return (spec.compile(seed: spec.seed ?? 1), spec)
    }

    /// Fraction of pixels that are not near-black.
    private func inkFraction<V: View>(_ view: V, size: CGSize = CGSize(width: 480, height: 270)) throws -> Double {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage, "renderer produced no image")
        let w = image.width, h = image.height
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = try XCTUnwrap(CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
                                          bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var lit = 0
        for i in stride(from: 0, to: pixels.count, by: 4)
        where Int(pixels[i]) + Int(pixels[i + 1]) + Int(pixels[i + 2]) > 36 { lit += 1 }
        return Double(lit) / Double(w * h)
    }

    // MARK: - Canvas tier (t3, and its t2 thinning path)

    func testKitchenSinkCompilesEveryLayer() throws {
        let s = try scene()
        XCTAssertEqual(s.layers.count, 10)
        XCTAssertFalse(s.layers.contains { $0.sprite == .unknown })
    }

    func testCanvasDrawsEverySpriteKindAtSeveralInstants() throws {
        let s = try scene()
        // 0 = the poster; 1.5 s = mid-emit and mid-fade-in; 30 s = steady state.
        for t in [0.0, 1.5, 30.0] {
            let view = NativeSceneView(layers: s.layers, background: s.spec.background,
                                       ghosting: s.spec.ghosting ?? 0, renderClass: .high,
                                       tier: .t3, staticFrame: true, staticTime: t)
            XCTAssertGreaterThan(try inkFraction(view), 0.2, "blank canvas at t=\(t)")
        }
    }

    func testCanvasThinnedTierStillDraws() throws {
        let s = try scene()
        let view = NativeSceneView(layers: s.layers, background: s.spec.background,
                                   renderClass: .legacy, tier: .t2, staticFrame: true, staticTime: 4)
        XCTAssertGreaterThan(try inkFraction(view), 0.2)
    }

    func testCanvasReferenceSizeFillsASmallTile() throws {
        let s = try scene()
        let view = NativeSceneView(layers: s.layers, background: s.spec.background, tier: .t3,
                                   referenceSize: CGSize(width: 1920, height: 1080), staticFrame: true)
        XCTAssertGreaterThan(try inkFraction(view, size: CGSize(width: 160, height: 90)), 0.2)
    }

    func testCanvasSurvivesAnEmptyScene() throws {
        let view = NativeSceneView(layers: [], background: nil, tier: .t3, staticFrame: true)
        XCTAssertEqual(try inkFraction(view), 0, accuracy: 0.001)
    }

    // MARK: - SpriteKit tier (t2 — the pre-4K Apple TV)

    private func present(_ layers: [CompiledLayer], _ bg: SpecSubset.Background?) -> CompiledSpriteScene {
        let view = SKView(frame: CGRect(x: 0, y: 0, width: 960, height: 540))
        let sprite = CompiledSpriteScene(layers: layers, background: bg)
        sprite.size = view.frame.size
        sprite.scaleMode = .resizeFill
        view.presentScene(sprite)
        // Keep the view alive for the scene's lifetime.
        objc_setAssociatedObject(sprite, "host", view, .OBJC_ASSOCIATION_RETAIN)
        return sprite
    }

    func testSpriteSceneBuildsNodesForEverySpriteKind() throws {
        let s = try scene()
        let sprite = present(s.layers, s.spec.background)
        // Background + at least one node per layer.
        XCTAssertGreaterThan(sprite.children.count, s.layers.count)
        XCTAssertTrue(sprite.matches(s.layers))
    }

    func testSpriteSceneAdvancesWithoutLosingNodes() throws {
        let s = try scene()
        let sprite = present(s.layers, s.spec.background)
        let built = sprite.children.count
        let before = sprite.children.map(\.position)
        for t in stride(from: 100.0, through: 106.0, by: 0.5) { sprite.update(t) }
        XCTAssertEqual(sprite.children.count, built)
        XCTAssertNotEqual(sprite.children.map(\.position), before, "nothing moved in 6 s")
        for node in sprite.children {
            XCTAssertTrue(node.position.x.isFinite && node.position.y.isFinite)
            XCTAssertTrue(node.alpha.isFinite && node.xScale.isFinite)
        }
    }

    func testSpriteSceneHoldsItsNodeBudget() throws {
        let heavy = ##"{"seed":2,"layers":[{"count":4000,"sprite":{"kind":"circle","radius":[0.002,0.004],"color":"#fff"},"motion":{"type":"drift","speed":[0.01,0.02]}}]}"##
        let s = try scene(heavy)
        let sprite = present(s.layers, nil)
        XCTAssertLessThanOrEqual(sprite.children.count, 502)
        XCTAssertGreaterThan(sprite.children.count, 100)
    }

    func testSpriteSceneRebuildsOnResizeAndSurvivesZeroSize() throws {
        let s = try scene()
        let sprite = present(s.layers, s.spec.background)
        let built = sprite.children.count
        sprite.size = .zero                       // mid-transition layout pass
        XCTAssertEqual(sprite.children.count, built)
        sprite.size = CGSize(width: 1920, height: 1080)
        XCTAssertEqual(sprite.children.count, built)
        sprite.update(1)
    }

    // MARK: - Classic ports

    func testEveryClassicPortDrawsAPosterOnBothTiers() throws {
        for kind in ClassicSaverKind.allCases {
            for tier in [CapabilityTier.t3, .t2] {
                let view = ClassicSaverView(kind: kind, seed: ClassicSaverKind.seed(forChannel: "lobby"),
                                            tier: tier, live: false)
                XCTAssertGreaterThan(try inkFraction(view), 0.002, "\(kind) blank on \(tier)")
            }
        }
    }

    func testAquariumDrawsEveryEnvironmentAndAFishMix() throws {
        for env in ["abyss", "reef", "kelp", "ice", "vent", "lagoon", "universe", "not-a-room"] {
            let view = ClassicSaverView(kind: .metaquarium, seed: 7, tier: .t3, live: false,
                                        params: ["environment": env, "fishMix": "seahorse:3,12,angelfish:2"])
            XCTAssertGreaterThan(try inkFraction(view), 0.01, "aquarium blank in \(env)")
        }
    }

    func testFishMixResolvesAgainstTheBundledCast() {
        XCTAssertNil(AquariumField.castIndices(fishMix: nil, cap: 10))
        XCTAssertNil(AquariumField.castIndices(fishMix: "", cap: 10))
        XCTAssertNil(AquariumField.castIndices(fishMix: "dragon:4,,:", cap: 10), "unknown breeds cast nobody")
        // Exact bundled id.
        XCTAssertEqual(AquariumField.castIndices(fishMix: "12", cap: 10), [0])
        // Count is honoured, clamped to 24, and the cap wins.
        XCTAssertEqual(AquariumField.castIndices(fishMix: "12:3", cap: 10)?.count, 3)
        XCTAssertEqual(AquariumField.castIndices(fishMix: "12:999", cap: 100)?.count, 24)
        XCTAssertEqual(AquariumField.castIndices(fishMix: "12:9", cap: 4)?.count, 4)
        // An unbundled id lands on a bundled fish of the same breed.
        let near = AquariumField.castIndices(fishMix: "13", cap: 1)
        XCTAssertNotNil(near)
        // A breed name casts the same fish every time.
        XCTAssertEqual(AquariumField.castIndices(fishMix: "seahorse:2", cap: 9),
                       AquariumField.castIndices(fishMix: " SeaHorse :2", cap: 9))
    }

    // MARK: - Always-renderable stand-ins

    func testFallbackAndProceduralArtAlwaysPaint() throws {
        XCTAssertGreaterThan(try inkFraction(FallbackSceneView(channelId: "lobby")), 0.01)
        XCTAssertGreaterThan(try inkFraction(ProceduralChannelArt(channelId: "lobby")), 0.2)
    }
}

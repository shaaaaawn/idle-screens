import SwiftUI
import XCTest
@testable import IdleScreensTV

/// A sequence `bed`: the ground under every segment, on a clock that never
/// resets at a boundary. Two live sequences put their whole ground in the
/// bed and declare no segment backgrounds, so without this the TV played
/// them on black.
@MainActor
final class BedTests: XCTestCase {

    static let bedded = ##"""
    {"format":"idle-sequence","schemaVersion":1,"id":"bedded","seed":7,"loop":true,
     "bed":{"background":{"type":"gradient","stops":[{"at":0,"color":"#203060"},{"at":1,"color":"#602040"}]},
            "layers":[{"key":"field","count":30,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#ffd27a"},
                       "motion":{"type":"drift","speed":[0.01,0.02]}}]},
     "segments":[
      {"key":"one","duration":60000,
       "scene":{"background":{"type":"solid","color":"#ff0000"},"ghosting":0.5,
                "layers":[{"count":2,"sprite":{"kind":"circle","radius":[0.05,0.05],"color":"#fff"},"motion":{"type":"static"}}]}},
      {"key":"two","duration":60000,"transition":{"type":"fade","dur":1500},
       "scene":{"layers":[{"count":5,"sprite":{"kind":"circle","radius":[0.05,0.05],"color":"#fff"},"motion":{"type":"static"}}]}}]}
    """##

    private func decode(_ json: String) throws -> SequenceSubset {
        try JSONDecoder().decode(SequenceSubset.self, from: Data(json.utf8))
    }

    func testTheBedDecodesAndSeedsPastEverySegment() throws {
        let seq = try decode(Self.bedded)
        XCTAssertEqual(seq.bed?.layers.count, 1)
        XCTAssertEqual(seq.bedSeed(fallback: 0), 7 + 24)
        var own = seq
        own.bed?.seed = 99
        XCTAssertEqual(own.bedSeed(fallback: 0), 99)
    }

    func testAnUnreadableBedLeavesTheSegmentsPlaying() throws {
        let broken = Self.bedded.replacingOccurrences(of: ##""bed":{"background""##, with: ##""bed":{"units":"furlongs","background""##)
        let seq = try decode(broken)
        XCTAssertNil(seq.bed)
        XCTAssertEqual(seq.segments.count, 2)
    }

    func testThePosterIsTheSegmentOnTheBedsGround() throws {
        let seq = try decode(Self.bedded)
        let poster = try XCTUnwrap(seq.posterScene)
        XCTAssertEqual(poster.background, seq.bed?.background, "the bed owns the ground")
        XCTAssertEqual(poster.layers.count, 2, "bed layers first, then the segment's")
        XCTAssertEqual(poster.layers.first?.key, "field")
    }

    private func makeApp() -> TVAppState {
        let base = URL(string: "https://bed-stub.test")!
        let transport = StubTransport(routes: [:])
        return TVAppState(gallery: GalleryClient(baseURL: base, transport: transport),
                          mcp: MCPClient(baseURL: base, transport: transport),
                          ws: ChannelWSClient(),
                          pair: PairClient(baseURL: base, transport: transport),
                          baseURL: base)
    }

    func testSegmentsPaintTransparentlyOverTheBed() throws {
        let app = makeApp()
        app.selectChannel("stage")
        app.handle(.scene(spec: try JSONDecoder().decode(JSONValue.self, from: Data(Self.bedded.utf8)), seed: 7))
        XCTAssertTrue(app.hasBed)
        XCTAssertEqual(app.bedScene.first?.entities.count, 30)
        XCTAssertNil(app.specBackground, "a segment's own background is never painted over a bed")
        XCTAssertEqual(app.specGhosting, 0, "nor its ghosting")
        XCTAssertEqual(app.compiledScene.first?.entities.count, 2)
        // A plain scene afterwards takes the bed away with the sequence.
        app.handle(.scene(spec: try JSONDecoder().decode(JSONValue.self, from: Data(##"{"seed":1,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},"motion":{"type":"static"}}]}"##.utf8)), seed: 1))
        XCTAssertFalse(app.hasBed)
        XCTAssertTrue(app.bedScene.isEmpty)
    }

    func testATransparentSegmentShowsTheBedsGroundOnBothTiers() throws {
        let seq = try decode(Self.bedded)
        let bed = try XCTUnwrap(seq.bed)
        let bedLayers = bed.compile(seed: 31)
        let segment = seq.segments[0].scene.compile(seed: 7)
        let canvas = ZStack {
            NativeSceneView(layers: bedLayers, background: bed.background, tier: .t3, staticFrame: true)
            NativeSceneView(layers: segment, background: nil, tier: .t3, staticFrame: true, transparentGround: true)
        }
        let r = ImageRenderer(content: canvas.frame(width: 320, height: 180))
        r.scale = 1
        let image = try XCTUnwrap(r.cgImage)
        // Mid-height pixel: the bed's gradient (blue-violet), not black and
        // not the segment's red ground.
        let px = try Self.pixel(image, x: 10, y: 90)
        XCTAssertGreaterThan(px.b, 40)
        XCTAssertLessThan(px.r, 140, "the segment's red background must not paint")
    }

    static func pixel(_ image: CGImage, x: Int, y: Int) throws -> (r: Int, g: Int, b: Int) {
        let w = image.width, h = image.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = try XCTUnwrap(CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let i = (y * w + x) * 4
        return (Int(px[i]), Int(px[i + 1]), Int(px[i + 2]))
    }
}

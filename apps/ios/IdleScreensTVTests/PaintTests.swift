import SwiftUI
import XCTest
@testable import IdleScreensTV

/// Paint-level layer fields (schema 3.10–3.11): `position.dx/dy`, layer
/// `opacity`, layer `transform` (with `origin: "anchor"`) and `groups`.
/// The golden vectors are the schema's own `paintMap` / `paintOpacity` /
/// `layerAnchor` (packages/schema/src/paint.ts) over one spec at three
/// aspects — the TV must put every point exactly where the web does.
@MainActor
final class PaintTests: XCTestCase {

    private struct Golden: Decodable {
        struct Anchor: Decodable { let x: Double; let y: Double }
        let w: Double, h: Double, li: Int
        let opacity: Double
        let anchor: Anchor
        let pts: [[Double]]
    }

    private func spec(_ json: String) throws -> SpecSubset {
        try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8))
    }

    func testTransformsLandEveryPointWhereTheWebDoes() throws {
        let s = try spec(specJSON)
        let layers = s.compile(seed: 1)
        let golden = try JSONDecoder().decode([Golden].self, from: Data(goldenJSON.utf8))
        XCTAssertEqual(golden.count, 15)
        for g in golden {
            let layer = layers[g.li]
            XCTAssertEqual(layer.opacity, g.opacity, accuracy: 1e-12, "opacity, layer \(g.li)")
            let size = CGSize(width: g.w, height: g.h)
            let m = layer.paint?.affine(in: size, unit: min(g.w, g.h)) ?? .identity
            for p in g.pts {
                let q = CGPoint(x: p[0], y: p[1]).applying(m)
                XCTAssertEqual(q.x, p[2], accuracy: 1e-6, "x, layer \(g.li) at \(g.w)x\(g.h)")
                XCTAssertEqual(q.y, p[3], accuracy: 1e-6, "y, layer \(g.li) at \(g.w)x\(g.h)")
            }
        }
    }

    func testOffsetMovesThePointInMinDimensionUnits() throws {
        let s = try spec(##"{"layers":[{"count":1,"position":{"x":0.5,"y":0.5,"dx":0.1,"dy":-0.25},"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},"motion":{"type":"static"}}]}"##)
        let e = s.compile(seed: 1)[0].entities[0]
        let p = SceneMotion.position(of: e, at: 3, in: CGSize(width: 1920, height: 1080), dim: 1080, wrap: true)
        XCTAssertEqual(p.x, 960 + 108, accuracy: 1e-9)
        XCTAssertEqual(p.y, 540 - 270, accuracy: 1e-9)
    }

    func testListAnchorTakesTheOffsetToo() throws {
        let s = try spec(##"{"layers":[{"count":3,"position":{"x":0.2,"y":0.2,"dx":0.1},"layout":{"type":"list","gap":0.1},"sprite":{"kind":"text","strings":["a","b","c"],"color":"#fff"},"motion":{"type":"static"}}]}"##)
        let es = s.compile(seed: 1)[0].entities
        XCTAssertEqual(es.map(\.offDX), [0.1, 0.1, 0.1])
    }

    func testMalformedPaintFieldsNeverDropTheScene() throws {
        let s = try spec(##"{"groups":"nope","layers":[{"count":1,"opacity":"x","transform":7,"group":3,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#fff"},"motion":{"type":"static"}}]}"##)
        let layer = s.compile(seed: 1)[0]
        XCTAssertEqual(layer.opacity, 1)
        XCTAssertNil(layer.paint)
        XCTAssertEqual(layer.entities.count, 1)
    }

    func testOpacityZeroPaintsNothingOnEitherTier() throws {
        let s = try spec(##"{"layers":[{"count":40,"opacity":0,"sprite":{"kind":"circle","radius":[0.05,0.08],"color":"#ffffff"},"motion":{"type":"static"}}]}"##)
        let layers = s.compile(seed: 2)
        let canvas = NativeSceneView(layers: layers, background: nil, tier: .t3, staticFrame: true)
        let renderer = ImageRenderer(content: canvas.frame(width: 320, height: 180))
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        XCTAssertEqual(try Self.litFraction(image), 0, accuracy: 0.0001, "an opacity-0 layer is skipped")
    }

    func testAScaledLayerCoversMoreOfTheFrame() throws {
        let base = ##"{"layers":[{"count":1,"position":{"x":0.5,"y":0.5},"sprite":{"kind":"circle","radius":[0.05,0.05],"color":"#ffffff"},"motion":{"type":"static"}"##
        func lit(_ extra: String) throws -> Double {
            let layers = try spec(base + extra + "}]}").compile(seed: 1)
            let r = ImageRenderer(content: NativeSceneView(layers: layers, background: nil, tier: .t3, staticFrame: true)
                .frame(width: 320, height: 180))
            r.scale = 1
            let img = try XCTUnwrap(r.cgImage)
            return try Self.litFraction(img)
        }
        let plain = try lit("")
        let scaled = try lit(##","transform":{"scale":3}"##)
        XCTAssertGreaterThan(plain, 0)
        XCTAssertGreaterThan(scaled, plain * 6, "3× scale ≈ 9× the area")
    }

    nonisolated static func litFraction(_ image: CGImage) throws -> Double {
        let w = image.width, h = image.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = try XCTUnwrap(CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var lit = 0
        for i in stride(from: 0, to: px.count, by: 4) where Int(px[i]) + Int(px[i + 1]) + Int(px[i + 2]) > 36 { lit += 1 }
        return Double(lit) / Double(w * h)
    }
}

private let specJSON = #"""
{"groups": {"dj": {"transform": {"scale": 1.4, "rotate": 12, "x": 0.05, "y": -0.1}, "opacity": 0.5}, "cam": {"transform": {"scaleX": -1}}}, "layers": [{"count": 1, "position": {"x": 0.5, "y": 0.72, "dx": 0.1, "dy": -0.2}, "transform": {"scale": 2, "rotate": 30, "origin": "anchor"}, "group": "dj", "opacity": 0.7, "sprite": {"kind": "circle", "radius": [0.01, 0.01], "color": "#fff"}, "motion": {"type": "static"}}, {"count": 1, "position": {"x": 0.3, "y": 0.4}, "transform": {"x": 0.2, "scaleX": 7, "scale": 0.5}, "sprite": {"kind": "circle", "radius": [0.01, 0.01], "color": "#fff"}, "motion": {"type": "static"}}, {"count": 1, "region": {"x": [0.1, 0.5], "y": [0.6, 1]}, "transform": {"rotate": -45, "origin": "anchor", "y": 0.1}, "group": "cam", "sprite": {"kind": "circle", "radius": [0.01, 0.01], "color": "#fff"}, "motion": {"type": "static"}}, {"count": 1, "position": {"x": 0.2, "y": 0.2}, "group": "dj", "sprite": {"kind": "circle", "radius": [0.01, 0.01], "color": "#fff"}, "motion": {"type": "static"}}, {"count": 1, "position": {"x": 0.2, "y": 0.2}, "group": "nosuch", "opacity": 1.7, "sprite": {"kind": "circle", "radius": [0.01, 0.01], "color": "#fff"}, "motion": {"type": "static"}}]}
"""#

private let goldenJSON = #"""
[{"w": 1920, "h": 1080, "li": 0, "opacity": 0.35, "anchor": {"x": 1068, "y": 561.6}, "pts": [[0, 0, -14.497122519800087, -2676.533109324387], [960, 540, 971.3506915488421, 245.724936690044], [576, 864, -434.7139108932083, 200.45669440609174], [123, 456, -612.904002824376, -1497.2372153248593]]}, {"w": 1920, "h": 1080, "li": 1, "opacity": 1, "anchor": {"x": 576, "y": 432}, "pts": [[0, 0, -2184, 270], [960, 540, 1176, 540], [576, 864, -168, 702], [123, 456, -1753.5, 498]]}, {"w": 1920, "h": 1080, "li": 2, "opacity": 1, "anchor": {"x": 576, "y": 864}, "pts": [[0, 0, 2362.2337649086285, 768.3532470182743], [960, 540, 1301.573593128807, 471.3683989199244], [576, 864, 1344, 972], [123, 456, 1952.8189386016174, 1003.8198051533946]]}, {"w": 1920, "h": 1080, "li": 3, "opacity": 0.5, "anchor": {"x": 384, "y": 216}, "pts": [[0, 0, -143.44913712800872, -586.9128986138255], [960, 540, 1014, 432], [576, 864, 393.8391068905705, 763.9144267092269], [123, 456, -107.74294369970494, 73.33892285345411]]}, {"w": 1920, "h": 1080, "li": 4, "opacity": 1, "anchor": {"x": 384, "y": 216}, "pts": [[0, 0, 0, 0], [960, 540, 960, 540], [576, 864, 576, 864], [123, 456, 123, 456]]}, {"w": 1080, "h": 1920, "li": 0, "opacity": 0.35, "anchor": {"x": 648, "y": 1166.3999999999999}, "pts": [[0, 0, 1518.7828136255891, -2475.040342240958], [540, 960, 843.7947198547988, 534.2584254568712], [324, 1536, -684.8331125294958, 1328.1122092609758], [123, 456, 920.3759333210137, -1295.7444482414303]]}, {"w": 1080, "h": 1920, "li": 1, "opacity": 1, "anchor": {"x": 324, "y": 768}, "pts": [[0, 0, -1134, 480], [540, 960, 756, 960], [324, 1536, 0, 1248], [123, 456, -703.5, 708]]}, {"w": 1080, "h": 1920, "li": 2, "opacity": 1, "anchor": {"x": 324, "y": 1536}, "pts": [[0, 0, 2071.2186130069786, 786.9865812019043], [540, 960, 1010.5584412271571, 1083.9714293002544], [324, 1536, 756, 1644], [123, 456, 1661.8037866999673, 1022.4531393370247]]}, {"w": 1080, "h": 1920, "li": 3, "opacity": 0.5, "anchor": {"x": 216, "y": 384}, "pts": [[0, 0, 133.9537263043115, -619.811613644461], [540, 960, 594, 852], [324, 1536, 130.54817806265612, 1577.9057299284505], [123, 456, 169.6599197326152, 40.440207822818934]]}, {"w": 1080, "h": 1920, "li": 4, "opacity": 1, "anchor": {"x": 216, "y": 384}, "pts": [[0, 0, 0, 0], [540, 960, 540, 960], [324, 1536, 324, 1536], [123, 456, 123, 456]]}, {"w": 800, "h": 800, "li": 0, "opacity": 0.35, "anchor": {"x": 480, "y": 416}, "pts": [[0, 0, 325.51199425304844, -1399.730012034348], [400, 400, 408.4079196658089, 182.01847162225482], [240, 640, -374.1767296212164, 381.64128269429534], [123, 456, -272.894886051527, -220.43411803482013]]}, {"w": 800, "h": 800, "li": 1, "opacity": 1, "anchor": {"x": 240, "y": 320}, "pts": [[0, 0, -840, 200], [400, 400, 560, 400], [240, 640, 0, 520], [123, 456, -409.5, 428]]}, {"w": 800, "h": 800, "li": 2, "opacity": 1, "anchor": {"x": 240, "y": 640}, "pts": [[0, 0, 1182.2539674441618, 437.157287525381], [400, 400, 616.5685424949238, 437.157287525381], [240, 640, 560, 720], [123, 456, 772.8391411371508, 672.6238456605013]]}, {"w": 800, "h": 800, "li": 3, "opacity": 0.5, "anchor": {"x": 160, "y": 160}, "pts": [[0, 0, 8.667890447014031, -344.19320326887646], [400, 400, 440, 320], [240, 640, 151.0366093208604, 602.0853751033806], [123, 456, 44.374083875317865, 316.05861819840334]]}, {"w": 800, "h": 800, "li": 4, "opacity": 1, "anchor": {"x": 160, "y": 160}, "pts": [[0, 0, 0, 0], [400, 400, 400, 400], [240, 640, 240, 640], [123, 456, 123, 456]]}]
"""#

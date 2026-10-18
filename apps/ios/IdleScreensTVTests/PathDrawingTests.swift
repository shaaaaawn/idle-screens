import SwiftUI
import XCTest
@testable import IdleScreensTV

/// Path drawings on the native tiers (schema PR #294): `polygon.path` /
/// `parts` with fill rules, gradients, strokes and span/origin.
/// Fixtures/paths-golden.json is the schema's own `flattenPath` output.
@MainActor
final class PathDrawingTests: XCTestCase {

    private struct Golden: Decodable {
        struct L: Decodable { let points: [[Double]]; let closed: Bool }
        let name: String
        let d: String
        let rule: String
        let subpaths: Int
        let points: [[Double]]
        let lines: [L]
        let error: String?
    }

    private static let golden: [Golden] = {
        let url = Bundle(for: PathDrawingTests.self).url(forResource: "paths-golden", withExtension: "json")!
        return try! JSONDecoder().decode([Golden].self, from: Data(contentsOf: url))
    }()

    // MARK: - Geometry parity

    func testFlattenMatchesTheSchemaPointForPoint() {
        XCTAssertGreaterThanOrEqual(Self.golden.count, 13)
        for g in Self.golden {
            let f = PathGeometry.flatten(g.d, rule: PathGeometry.FillRule(rawValue: g.rule)!)
            XCTAssertNil(f.error, g.name)
            XCTAssertEqual(f.subpaths, g.subpaths, "\(g.name): subpaths")
            XCTAssertEqual(f.points.count, g.points.count, "\(g.name): points")
            for (p, q) in zip(f.points, g.points) {
                XCTAssertEqual(p.0, q[0], accuracy: 1e-9, g.name)
                XCTAssertEqual(p.1, q[1], accuracy: 1e-9, g.name)
            }
            XCTAssertEqual(f.lines.count, g.lines.count, "\(g.name): lines")
            for (l, m) in zip(f.lines, g.lines) {
                XCTAssertEqual(l.closed, m.closed, g.name)
                XCTAssertEqual(l.points.count, m.points.count, "\(g.name): line points")
                for (p, q) in zip(l.points, m.points) {
                    XCTAssertEqual(p.0, q[0], accuracy: 1e-9, g.name)
                    XCTAssertEqual(p.1, q[1], accuracy: 1e-9, g.name)
                }
            }
        }
    }

    func testExponentNumbersParse() {
        let f = PathGeometry.flatten("M -0.6 3.6739403974420595e-17 L 0 1e-17 L 0 0.5 Z")
        XCTAssertNil(f.error)
        XCTAssertEqual(f.points.count, 3)
    }

    // MARK: - Decoding

    private func layers(_ sprite: String, extra: String = "") throws -> [CompiledLayer] {
        let json = ##"{"layers":[{"count":1,"position":{"x":0.5,"y":0.5},"alpha":[1,1],"sprite":"## + sprite
            + ##","motion":{"type":"static"}"## + extra + "}]}"
        return try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8)).compile(seed: 1)
    }

    func testPathAndPartsDecodeToADrawing() throws {
        let single = try layers(##"{"kind":"polygon","radius":[0.3,0.3],"color":"#ff0000","path":"M 0 -1 L 1 1 L -1 1 Z","stroke":{"color":"#000000","width":0.02},"gradient":{"type":"linear","from":[0,-1],"to":[0,1],"stops":[{"at":0,"color":"#000000"},{"at":1,"color":"#ffffff","opacity":0.5}]}}"##)
        guard case .polygon(_, _, _, _, _, _, let d1) = single[0].sprite, let d1 else { return XCTFail("no drawing") }
        XCTAssertEqual(d1.parts.count, 1)
        XCTAssertNotNil(d1.parts[0].gradient)
        XCTAssertEqual(d1.parts[0].stroke?.width, 0.02)
        XCTAssertNil(d1.parts[0].color, "a single path takes the entity's colour")

        let multi = try layers(##"{"kind":"polygon","radius":[0.3,0.3],"color":"#ffffff","span":"width","origin":[0,1],"parts":[{"path":"M -1 0 L 1 0 L 1 1 L -1 1 Z","color":"#336633"},{"path":"M -0.5 0.5 L 0.5 0.5","fill":false,"stroke":{"color":"#000000","width":0.01},"opacity":0.5}]}"##)
        guard case .polygon(_, _, _, _, _, _, let d2) = multi[0].sprite, let d2 else { return XCTFail("no drawing") }
        XCTAssertEqual(d2.parts.count, 2)
        XCTAssertEqual(d2.parts[0].color, "#336633")
        XCTAssertFalse(d2.parts[1].fill)
        XCTAssertEqual(d2.parts[1].opacity, 0.5)
        XCTAssertEqual(d2.span, "width")
        XCTAssertEqual(d2.origin.1, 1)
        let fr = d2.frame(r: 100, width: 1920, height: 1080)
        XCTAssertEqual(fr.sx, 960); XCTAssertEqual(fr.sy, 100)

        // A plain polygon has no drawing (and keeps its n-gon).
        let plain = try layers(##"{"kind":"polygon","radius":[0.3,0.3],"sides":5,"color":"#ffffff"}"##)
        guard case .polygon(_, _, _, let sides, _, _, let d3) = plain[0].sprite else { return XCTFail() }
        XCTAssertNil(d3); XCTAssertEqual(sides, 5)
    }

    // MARK: - Pixels

    private func render(_ layers: [CompiledLayer], tier: CapabilityTier = .t3, w: CGFloat = 320, h: CGFloat = 180,
                        background: String = "#000000") throws -> (px: [UInt8], w: Int, h: Int) {
        let view = NativeSceneView(layers: layers, background: .init(color: background), tier: tier, staticFrame: true)
        let r = ImageRenderer(content: view.frame(width: w, height: h))
        r.scale = 1
        let image = try XCTUnwrap(r.cgImage)
        let iw = image.width, ih = image.height
        var px = [UInt8](repeating: 0, count: iw * ih * 4)
        let ctx = try XCTUnwrap(CGContext(data: &px, width: iw, height: ih, bitsPerComponent: 8, bytesPerRow: iw * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: iw, height: ih))
        return (px, iw, ih)
    }

    /// Red channel at (x, y) in top-left image coordinates (CG bitmap rows are bottom-up).
    private func red(_ r: (px: [UInt8], w: Int, h: Int), _ x: Int, _ y: Int) -> Int {
        Int(r.px[((r.h - 1 - y) * r.w + x) * 4])
    }

    func testAHoleIsEmptyAndTheRingIsLit() throws {
        // A ring: outer disc with an inner hole (auto rule) at the centre of a 320×180 frame.
        let ring = "M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z M -0.5 0 A 0.5 0.5 0 1 1 0.5 0 A 0.5 0.5 0 1 1 -0.5 0 Z"
        let r = try render(try layers(##"{"kind":"polygon","radius":[0.45,0.45],"color":"#ffffff","path":""## + ring + ##""}"##))
        XCTAssertLessThan(red(r, 160, 90), 20, "the hole is empty (not a filled hexagon)")
        XCTAssertGreaterThan(red(r, 160 + 60, 90), 200, "the ring is lit")
        XCTAssertLessThan(red(r, 160 + 78, 90 + 70), 20, "outside the disc is empty")
    }

    func testATrianglePathIsNotAHexagon() throws {
        let r = try render(try layers(##"{"kind":"polygon","radius":[0.45,0.45],"color":"#ffffff","path":"M 0 -1 L 1 1 L -1 1 Z"}"##))
        // Upper-left, inside a hexagon's body but outside the triangle.
        XCTAssertLessThan(red(r, 160 - 60, 90 - 30), 20)
        XCTAssertGreaterThan(red(r, 160, 90 + 40), 200)
    }

    func testALinearGradientRunsDarkToLight() throws {
        let r = try render(try layers(##"{"kind":"polygon","radius":[0.45,0.45],"color":"#ff0000","path":"M -1 -1 L 1 -1 L 1 1 L -1 1 Z","gradient":{"type":"linear","from":[-1,0],"to":[1,0],"stops":[{"at":0,"color":"#000000"},{"at":1,"color":"#ffffff"}]}}"##))
        let left = red(r, 160 - 70, 90), right = red(r, 160 + 70, 90)
        XCTAssertLessThan(left, 60)
        XCTAssertGreaterThan(right, 190)
    }

    func testSpanScreenCoversTheFrameOnEveryAspect() throws {
        for (w, h) in [(CGFloat(320), CGFloat(180)), (180, 320)] {
            let r = try render(try layers(##"{"kind":"polygon","radius":[0.1,0.1],"color":"#ffffff","span":"screen","path":"M -1 -1 L 1 -1 L 1 1 L -1 1 Z"}"##), w: w, h: h)
            XCTAssertGreaterThan(red(r, 2, 2), 200, "top-left corner")
            XCTAssertGreaterThan(red(r, r.w - 3, r.h - 3), 200, "bottom-right corner")
        }
    }

    func testStrokeOnlyLineArtDrawsInk() throws {
        let r = try render(try layers(##"{"kind":"polygon","radius":[0.45,0.45],"color":"#000000","path":"M -1 0 L 1 0","fill":false,"stroke":{"color":"#ffffff","width":0.06}}"##))
        XCTAssertGreaterThan(red(r, 160, 90), 200, "the line")
        XCTAssertLessThan(red(r, 160, 90 + 30), 20, "nothing filled")
    }

    func testSpriteTierRasterAnchorsAtTheOrigin() throws {
        let decoded = try layers(##"{"kind":"polygon","radius":[0.3,0.3],"color":"#ffffff","origin":[0,1],"path":"M -1 -1 L 1 -1 L 1 1 L -1 1 Z"}"##)
        guard case .polygon(_, _, _, _, _, _, let d) = decoded[0].sprite, let d else { return XCTFail() }
        let ras = try XCTUnwrap(PathRaster.raster(d, color: "#ffffff", r: 64, width: 1920, height: 1080, scale: 1))
        // origin [0, 1]: the anchor is the square's bottom edge, horizontally centred.
        XCTAssertEqual(Double(ras.anchor.x) / Double(ras.image.width), 0.5, accuracy: 0.02)
        XCTAssertGreaterThan(Double(ras.anchor.y) / Double(ras.image.height), 0.9)
    }

    func testVisibilityCountsTheDrawingNotAHexagon() throws {
        // A thin path line: tiny real area — a hexagon of the same radius would read as lots of ink.
        let line = try layers(##"{"kind":"polygon","radius":[0.4,0.4],"color":"#ffffff","path":"M -1 -0.01 L 1 -0.01 L 1 0.01 L -1 0.01 Z"}"##)
        guard case .polygon(_, _, _, _, _, _, let d) = line[0].sprite, let d else { return XCTFail() }
        let a = d.area(r: 0.4 * 1080, width: 1920, height: 1080)
        XCTAssertLessThan(a, 0.05 * pow(0.4 * 1080, 2))
    }

    // MARK: - Snapshots (opt-in)

    /// Renders the round-1…4 demo specs to PNGs for a visual check:
    /// TEST_RUNNER_PATH_SNAPSHOT_SPECS=<dir with *.json> TEST_RUNNER_PATH_SNAPSHOT_OUT=<dir>.
    func testSnapshotDemoScenes() throws {
        let env = ProcessInfo.processInfo.environment
        guard let specDir = env["PATH_SNAPSHOT_SPECS"], let outDir = env["PATH_SNAPSHOT_OUT"] else {
            throw XCTSkip("set TEST_RUNNER_PATH_SNAPSHOT_SPECS / _OUT to render demo snapshots")
        }
        let names = (env["PATH_SNAPSHOT_NAMES"] ?? "peacock-parts,moth-styled,balloons-after,anchor-after,rose-after,city-after")
            .split(separator: ",").map(String.init)
        for name in names {
            let data = try Data(contentsOf: URL(fileURLWithPath: "\(specDir)/\(name).json"))
            let spec = try JSONDecoder().decode(SpecSubset.self, from: data)
            let layers = spec.compile(seed: 7)
            for (tier, tag) in [(CapabilityTier.t3, "canvas")] {
                let view = NativeSceneView(layers: layers, background: spec.background, tier: tier, staticFrame: true, staticTime: 4)
                let r = ImageRenderer(content: view.frame(width: 960, height: 540))
                r.scale = 1
                let img = try XCTUnwrap(r.uiImage)
                try XCTUnwrap(img.pngData()).write(to: URL(fileURLWithPath: "\(outDir)/tvos-\(name)-\(tag).png"))
            }
        }
    }
}

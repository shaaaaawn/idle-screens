import SwiftUI
import XCTest
@testable import IdleScreensTV

/// Paint parity with schema PR #278: one-fill tapered strokes (X386), the
/// trail ribbon and shaped/gap-filled echoes (X387, X469), and the feather
/// ramp (X383). Fixtures/shapes-golden.json is the schema's own
/// `strokeOutline`, `ribbonSides`, `featherRamp` and `trailEchoes` output.
@MainActor
final class ShapeParityTests: XCTestCase {

    private struct P: Decodable { let x: Double; let y: Double }
    private struct Golden: Decodable {
        struct Outline: Decodable { let pts: [P]; let lw: Double; let taper: Bool; let out: [P] }
        struct Ribbon: Decodable { let pts: [P]; let half: [Double]; let left: [P]; let right: [P] }
        struct Ramp: Decodable { let f: Double; let v: [Double] }
        struct Cfg: Decodable { let length: Double; let fade: Double? }
        struct Echo: Decodable { let t: Double; let x: Double; let y: Double; let k: Double; let alpha: Double; let r: Double }
        struct Trail: Decodable { let name: String; let cfg: Cfg; let fill: Int; let additive: Bool; let t: Double; let out: [Echo] }
        let outlines: [Outline]
        let ribbons: [Ribbon]
        let ramps: [Ramp]
        let trails: [Trail]
    }

    private static let golden: Golden = {
        let url = Bundle(for: ShapeParityTests.self).url(forResource: "shapes-golden", withExtension: "json")!
        return try! JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }()

    private func pt(_ p: P) -> CGPoint { CGPoint(x: p.x, y: p.y) }

    private func assertSame(_ a: [CGPoint], _ b: [P], _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.count, b.count, "\(what): point count", file: file, line: line)
        for (p, q) in zip(a, b) {
            XCTAssertEqual(p.x, q.x, accuracy: 1e-9, what, file: file, line: line)
            XCTAssertEqual(p.y, q.y, accuracy: 1e-9, what, file: file, line: line)
        }
    }

    func testStrokeOutlinesMatchTheEngine() {
        for g in Self.golden.outlines {
            let out = NativeSceneView.strokeOutline(g.pts.map(pt), lineWidth: g.lw, taper: g.taper)
            assertSame(out, g.out, "outline lw=\(g.lw) taper=\(g.taper) n=\(g.pts.count)")
        }
    }

    func testRibbonSidesMatchTheEngine() {
        for g in Self.golden.ribbons {
            let sides = NativeSceneView.ribbonSides(g.pts.map(pt), half: g.half)
            assertSame(sides.left, g.left, "left n=\(g.pts.count)")
            assertSame(sides.right, g.right, "right n=\(g.pts.count)")
        }
    }

    func testFeatherStopsAreTheEnginesRamp() {
        // The gradient stops, linearly interpolated, must reproduce featherRamp.
        for g in Self.golden.ramps {
            let stops = NativeSceneView.featherStops(g.f)
            for (u, want) in zip([0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.95, 1.0], g.v) {
                let hi = stops.firstIndex { $0.at >= u } ?? stops.count - 1
                let lo = max(0, hi - 1)
                let a = stops[lo], b = stops[hi]
                let got = b.at == a.at ? b.alpha : a.alpha + (b.alpha - a.alpha) * (u - a.at) / (b.at - a.at)
                XCTAssertEqual(got, want, accuracy: 1e-9, "feather \(g.f) at u=\(u)")
            }
        }
    }

    func testTrailEchoesMatchTheEngine() {
        let fast: (Double) -> CGPoint = { t in CGPoint(x: 960 + 600 * cos(t / 700), y: 540 + 300 * sin(t / 500)) }
        let slow: (Double) -> CGPoint = { t in
            CGPoint(x: ((100 + t * 0.4).truncatingRemainder(dividingBy: 1920) + 1920).truncatingRemainder(dividingBy: 1920), y: 300)
        }
        XCTAssertEqual(Self.golden.trails.count, 96)
        for g in Self.golden.trails {
            let posMs = g.name == "fast" ? fast : slow
            let trail = SpecSubset.Trail(length: g.cfg.length, fade: g.cfg.fade)
            // Swift's clock is seconds; the golden's is ms.
            let got = NativeSceneView.trailEchoes(trail, at: g.t / 1000, headAlpha: 0.8, headRadius: 12,
                                                  posAt: { posMs($0 * 1000) },
                                                  in: CGSize(width: 1920, height: 1080), wrap: true,
                                                  fillBudget: g.fill, additive: g.additive)
            let what = "\(g.name) len=\(g.cfg.length) fill=\(g.fill) add=\(g.additive) t=\(g.t)"
            XCTAssertEqual(got.count, g.out.count, what)
            for (e, w) in zip(got, g.out) {
                XCTAssertEqual(e.t * 1000, w.t, accuracy: 1e-6, what)
                XCTAssertEqual(e.point.x, w.x, accuracy: 1e-6, what)
                XCTAssertEqual(e.point.y, w.y, accuracy: 1e-6, what)
                XCTAssertEqual(e.alpha, w.alpha, accuracy: 1e-9, what)
                XCTAssertEqual(e.r, w.r, accuracy: 1e-9, what)
            }
        }
    }

    /// A translucent tapered stroke paints every pixel once: no pixel along
    /// the mark is brighter than the mark's own alpha allows (a bead is a
    /// doubled overlap, ~2× as bright).
    func testATranslucentTaperedStrokeHasNoBeads() throws {
        let json = ##"{"layers":[{"count":1,"position":{"x":0.5,"y":0.5},"alpha":[0.4,0.4],"sprite":{"kind":"stroke","length":[0.8,0.8],"points":[[-1,0],[-0.5,0.4],[0,-0.3],[0.5,0.4],[1,0]],"width":0.04,"taper":true,"color":"#ffffff"},"motion":{"type":"static"}}]}"##
        let layers = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8)).compile(seed: 1)
        let view = NativeSceneView(layers: layers, background: .init(color: "#000000"), tier: .t3, staticFrame: true)
        let r = ImageRenderer(content: view.frame(width: 400, height: 225))
        r.scale = 1
        let image = try XCTUnwrap(r.cgImage)
        let w = image.width, h = image.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = try XCTUnwrap(CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var brightest = 0, lit = 0
        for i in stride(from: 0, to: px.count, by: 4) {
            brightest = max(brightest, Int(px[i]))
            if px[i] > 20 { lit += 1 }
        }
        XCTAssertGreaterThan(lit, 200, "the stroke drew")
        // 40 % white over black ≈ 102; a doubled joint would reach ≈ 163.
        XCTAssertLessThanOrEqual(brightest, 110, "a joint painted twice")
    }

    func testShapedAndRibbonTrailsDraw() throws {
        for sprite in [##"{"kind":"circle","radius":[0.02,0.02],"color":"#fff"}"##,
                       ##"{"kind":"polygon","radius":[0.02,0.02],"sides":5,"color":"#fff"}"##,
                       ##"{"kind":"rect","width":[0.03,0.03],"feather":0.6,"color":"#fff"}"##] {
            let json = ##"{"layers":[{"count":4,"trail":{"length":1500,"fade":0.8},"sprite":"## + sprite
                + ##","motion":{"type":"orbit","center":{"x":0.5,"y":0.5},"radius":[0.3,0.3],"speed":[90,90]}}]}"##
            let layers = try JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8)).compile(seed: 1)
            let view = NativeSceneView(layers: layers, background: .init(color: "#000000"), tier: .t3,
                                       staticFrame: true, staticTime: 3)
            let r = ImageRenderer(content: view.frame(width: 320, height: 180))
            r.scale = 1
            let img = try XCTUnwrap(r.cgImage)
            XCTAssertGreaterThan(try PaintTests.litFraction(img), 0.01, sprite)
        }
    }
}

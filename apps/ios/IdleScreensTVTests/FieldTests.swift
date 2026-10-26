import XCTest
@testable import IdleScreensTV

/// The `field` background and the print `finish`, pinned to the TypeScript
/// engine's own output (packages/schema/src/field.ts, finish.ts): the lattice
/// hash, the sampler over five configs × four seeds × six times, the colour
/// ramp, the grain and Bayer tiles and the animated grain offset. The golden
/// comes from a throwaway vitest file (see the README's parity section).
final class FieldTests: XCTestCase {

    private struct Golden: Decodable {
        struct Config: Decodable {
            let cfg: JSONValue
            let samples: [Sample]
        }
        struct Sample: Decodable {
            let seed: Double, t: Double, u: Double, v: Double, ft: Double, value: Double
            let rgb: [Int]
        }
        struct Hash: Decodable { let x: Int64, y: Int64, s: Double, h: Double }
        struct Grain: Decodable { let seed: Double; let sum: Int; let sampled: [[Int]] }
        struct Offset: Decodable {
            struct XY: Decodable { let x: Int; let y: Int }
            let t: Double, seed: Double
            let off: XY
        }
        let field: [Config]
        let hashes: [Hash]
        let grain: [Grain]
        let dither: [Int]
        let offsets: [Offset]
    }

    private func golden() throws -> Golden {
        let url = try XCTUnwrap(Bundle(for: FieldTests.self).url(forResource: "field-golden", withExtension: "json"))
        return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
    }

    func testLatticeHashMatchesTheWebBitForBit() throws {
        for h in try golden().hashes {
            XCTAssertEqual(FieldSampler.latticeHash(h.x, h.y, jsUint32(h.s)), h.h, "hash(\(h.x), \(h.y), \(h.s))")
        }
    }

    func testFieldSamplesAndColoursMatchTheWeb() throws {
        let g = try golden()
        XCTAssertEqual(g.field.count, 5)
        for config in g.field {
            let bg = try JSONDecoder().decode(SpecSubset.Background.self, from: JSONEncoder().encode(config.cfg))
            XCTAssertTrue(bg.isField)
            for s in config.samples {
                // The renderer passes the normalised instance seed; these seeds are never 0.
                let seed = jsUint32(s.seed)
                XCTAssertEqual(FieldSampler.sampleTime(bg, s.t), s.ft, "bucket at \(s.t)")
                let v = FieldSampler.value(s.u, s.v, s.ft, bg, seed: seed)
                XCTAssertEqual(v, s.value, accuracy: 1e-12, "value \(s)")
                let rgb = FieldSampler.rgb(v, bands: bg.bands ?? [], quantize: bg.quantize)
                XCTAssertEqual([rgb.0, rgb.1, rgb.2], s.rgb, "rgb \(s)")
            }
        }
    }

    func testGrainAndDitherTilesMatchTheWeb() throws {
        let g = try golden()
        for grain in g.grain {
            let levels = FinishTiles.grainLevels(seed: jsUint32(grain.seed))
            XCTAssertEqual(levels.reduce(0) { $0 + Int($1) }, grain.sum, "grain sum, seed \(grain.seed)")
            for pair in grain.sampled { XCTAssertEqual(Int(levels[pair[0]]), pair[1]) }
        }
        XCTAssertEqual(FinishTiles.ditherLevels().map(Int.init), g.dither)
        for o in g.offsets {
            let off = FinishTiles.grainOffset(t: o.t, seed: jsUint32(o.seed), animate: true)
            XCTAssertEqual(off.x, o.off.x, "x at \(o.t)")
            XCTAssertEqual(off.y, o.off.y, "y at \(o.t)")
        }
        XCTAssertEqual(FinishTiles.grainOffset(t: 5000, seed: 1, animate: false).x, 0)
    }

    func testFieldRasterIsWebSizedAndCrispWhenQuantised() throws {
        let bg = try JSONDecoder().decode(SpecSubset.Background.self, from: Data(
            ##"{"type":"field","scale":2,"bands":["#000000","#ffffff"],"quantize":2}"##.utf8))
        let ras = try XCTUnwrap(FieldRaster.raster(bg, seed: 1, width: 1920, height: 1080, t: 0))
        XCTAssertEqual(ras.image.width, 171)   // round(96 × 16/9)
        XCTAssertEqual(ras.image.height, 96)
        XCTAssertTrue(ras.crisp)
        let low = try XCTUnwrap(FieldRaster.raster(bg, seed: 1, width: 1920, height: 1080, t: 0,
                                                   shortSide: FieldSampler.shortSideLow))
        XCTAssertEqual(low.image.height, 48)
    }

    func testMalformedFinishNeverDropsTheScene() throws {
        let s = try JSONDecoder().decode(SpecSubset.self, from: Data(
            ##"{"finish":"grainy","layers":[{"count":1,"sprite":{"kind":"circle"},"motion":{"type":"static"}}]}"##.utf8))
        XCTAssertFalse(s.finish?.isVisible ?? false)
        XCTAssertEqual(s.layers.count, 1)
    }
}

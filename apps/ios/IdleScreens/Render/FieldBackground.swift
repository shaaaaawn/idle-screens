import CoreGraphics
import Foundation

/// The `field` background (schema 3.x): seeded value noise, optionally
/// domain-warped, quantised into `bands`. A port of packages/schema/src/field.ts,
/// point for point — the sampler is a pure function of `(u, v, t, config,
/// seed)`, so the TV's raster and the web's agree by construction
/// (`FieldTests` pins it against the TypeScript's own output).
///
/// JS integer arithmetic (`Math.imul`, `| 0`, `>>> 0`) is all mod 2³², so the
/// hash runs in wrapping `UInt32` arithmetic: the same bits on every platform.
enum FieldSampler {
    /// A drifting field's raster is recomputed at most this often (ms).
    static let bucketMs = 100.0
    /// Raster short side, px; halved on the sprite tier (the web's `basic` tier).
    static let shortSide = 96
    static let shortSideLow = 48
    static let defaultDriftAmount = 0.3
    private static let warpGain = 2.0
    private static let driftGain = 1.0
    private static let contrast: [Double] = [1, 1.45, 1.8, 1.95, 2.0]

    /// `latticeHash`: integer lattice → 0..1.
    static func latticeHash(_ ix: Int64, _ iy: Int64, _ seed: UInt32) -> Double {
        let x = UInt32(truncatingIfNeeded: ix), y = UInt32(truncatingIfNeeded: iy)
        var h = (x &* 0x27d4_eb2d) ^ (y &* 0x1656_67b1) ^ (seed &* 0x9e37_79b1)
        h = (h ^ (h >> 15)) &* 0x85eb_ca6b
        h = (h ^ (h >> 13)) &* 0xc2b2_ae35
        h ^= h >> 16
        return Double(h) / 4_294_967_296
    }

    private static func smoothstep(_ k: Double) -> Double { k * k * (3 - 2 * k) }

    private static func valueNoise(_ x: Double, _ y: Double, _ seed: UInt32) -> Double {
        let fx0 = x.rounded(.down), fy0 = y.rounded(.down)
        let x0 = Int64(fx0), y0 = Int64(fy0)
        let fx = smoothstep(x - fx0), fy = smoothstep(y - fy0)
        let a = latticeHash(x0, y0, seed)
        let b = latticeHash(x0 + 1, y0, seed)
        let c = latticeHash(x0, y0 + 1, seed)
        let d = latticeHash(x0 + 1, y0 + 1, seed)
        let top = a + (b - a) * fx
        let bottom = c + (d - c) * fx
        return top + (bottom - top) * fy
    }

    private static func fbm(_ x: Double, _ y: Double, _ seed: UInt32, _ octaves: Int) -> Double {
        var sum = 0.0, amp = 1.0, norm = 0.0, f = 1.0
        for i in 0..<octaves {
            sum += amp * valueNoise(x * f + Double(i) * 17.3, y * f + Double(i) * 31.7, seed &+ UInt32(i * 101))
            norm += amp
            amp *= 0.5
            f *= 2
        }
        return sum / norm
    }

    static func octaves(_ cfg: SpecSubset.Background) -> Int {
        let o = Int(jsRound(cfg.octaves ?? 2))
        return Swift.min(4, Swift.max(1, o))
    }

    /// The time a field is sampled at: the 100 ms bucket while it drifts, else 0.
    static func sampleTime(_ cfg: SpecSubset.Background, _ t: Double) -> Double {
        guard let drift = cfg.drift, drift.amount != 0 else { return 0 }
        return (t / bucketMs).rounded(.down) * bucketMs
    }

    /// `fieldAt`: the scalar field at short-side coords (u, v), time `t` ms, 0..1.
    /// `seed` is the instance seed (already normalised); `cfg.seed` overrides it.
    static func value(_ u: Double, _ v: Double, _ t: Double, _ cfg: SpecSubset.Background, seed: UInt32) -> Double {
        let scale = cfg.scale ?? 4
        let oct = octaves(cfg)
        let s = cfg.seed.map(jsUint32) ?? seed
        var x = u * scale, y = v * scale
        if let drift = cfg.drift, drift.period > 0 {
            let phase = 2 * Double.pi * t / drift.period
            let r = (drift.amount ?? defaultDriftAmount) * driftGain
            x += r * sin(phase)
            y += r * cos(phase)
        }
        let warp = cfg.warp ?? 0
        if warp > 0 {
            let qx = fbm(x + 5.2, y + 1.3, s &+ 7919, oct) - 0.5
            let qy = fbm(x + 1.7, y + 9.2, s &+ 104_729, oct) - 0.5
            x += warp * warpGain * qx
            y += warp * warpGain * qy
        }
        let raw = fbm(x, y, s, oct)
        return Swift.min(1, Swift.max(0, 0.5 + (raw - 0.5) * contrast[oct]))
    }

    /// `hexToRgb255`: malformed input reads as mid grey.
    static func rgb255(_ hex: String) -> (Int, Int, Int) {
        var h = hex
        if h.count == 4, h.first == "#" {
            let c = Array(h.dropFirst())
            h = "#" + c.map { "\($0)\($0)" }.joined()
        }
        guard h.count == 7, h.first == "#", let n = Int(h.dropFirst(), radix: 16) else { return (128, 128, 128) }
        return ((n >> 16) & 255, (n >> 8) & 255, n & 255)
    }

    /// `fieldRgb`: posterised (quantize ≥ 2) or smooth (0) along the bands ramp.
    static func rgb(_ value: Double, bands: [String], quantize: Double?) -> (Int, Int, Int) {
        let n = bands.count
        guard n > 0 else { return (128, 128, 128) }
        guard n > 1 else { return rgb255(bands[0]) }
        let q = Int(jsRound(quantize ?? Double(n)))
        let c = Swift.min(1, Swift.max(0, value))
        let f: Double
        if q >= 2 {
            let level = Swift.min(q - 1, Int((c * Double(q)).rounded(.down)))
            f = Double(level * (n - 1)) / Double(q - 1)
        } else {
            f = c * Double(n - 1)
        }
        let i = Swift.min(n - 2, Int(f.rounded(.down)))
        let k = f - Double(i)
        let a = rgb255(bands[i])
        if k == 0 { return a }
        let b = rgb255(bands[i + 1])
        return (Int(jsRound(Double(a.0) + Double(b.0 - a.0) * k)),
                Int(jsRound(Double(a.1) + Double(b.1 - a.1) * k)),
                Int(jsRound(Double(a.2) + Double(b.2 - a.2) * k)))
    }

    /// JavaScript's Math.round (halves toward +∞).
    static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }
}

/// A field background rastered once per (config, size, time bucket) at the
/// web's resolution, then stretched over the frame — nearest-neighbour for
/// quantised bands so contours stay crisp, smoothed for `quantize: 0`.
enum FieldRaster {
    struct Raster {
        let image: CGImage
        /// Quantised bands draw without interpolation.
        let crisp: Bool
    }

    // NSCache is thread-safe; its values are immutable rasters.
    nonisolated(unsafe) private static let cache = NSCache<NSString, Box>()
    private final class Box { let r: Raster; init(_ r: Raster) { self.r = r } }

    /// Raster for a `w`×`h` frame at scene time `t` (ms). `seed` is the
    /// instance seed, normalised (`(seed >>> 0) || 1`).
    static func raster(_ bg: SpecSubset.Background, seed: UInt32, width w: Double, height h: Double,
                       t: Double, shortSide: Int = FieldSampler.shortSide) -> Raster? {
        guard let bands = bg.bands, !bands.isEmpty, w > 0, h > 0 else { return nil }
        let short = Swift.max(1, Swift.min(w, h))
        let cols = Swift.max(1, Int(FieldSampler.jsRound(Double(shortSide) * w / short)))
        let rows = Swift.max(1, Int(FieldSampler.jsRound(Double(shortSide) * h / short)))
        let ft = FieldSampler.sampleTime(bg, t)
        let key = "\(bg.fieldKey)|\(seed)|\(w)x\(h)|\(cols)x\(rows)|\(ft)" as NSString
        if let hit = cache.object(forKey: key) { return hit.r }
        var px = [UInt8](repeating: 255, count: cols * rows * 4)
        var i = 0
        for r in 0..<rows {
            let v = (Double(r) + 0.5) * h / Double(rows) / short
            for c in 0..<cols {
                let u = (Double(c) + 0.5) * w / Double(cols) / short
                let rgb = FieldSampler.rgb(FieldSampler.value(u, v, ft, bg, seed: seed), bands: bands, quantize: bg.quantize)
                px[i] = UInt8(clamping: rgb.0); px[i + 1] = UInt8(clamping: rgb.1); px[i + 2] = UInt8(clamping: rgb.2)
                i += 4
            }
        }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let image = CGImage(width: cols, height: rows, bitsPerComponent: 8, bitsPerPixel: 32,
                                  bytesPerRow: cols * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false,
                                  intent: .defaultIntent)
        else { return nil }
        let raster = Raster(image: image, crisp: Int(FieldSampler.jsRound(bg.quantize ?? Double(bands.count))) >= 2)
        cache.setObject(Box(raster), forKey: key)
        return raster
    }
}

extension SpecSubset.Background {
    var isField: Bool { type == "field" && !(bands ?? []).isEmpty }

    /// Identity of a field's config, for the raster cache.
    var fieldKey: String {
        let d = drift.map { "\($0.period),\($0.amount.map { "\($0)" } ?? "-")" } ?? "-"
        return [bands?.joined(separator: ",") ?? "", "\(scale ?? 4)", "\(octaves ?? 2)", "\(warp ?? 0)",
                quantize.map { "\($0)" } ?? "-", seed.map { "\($0)" } ?? "-", d].joined(separator: "|")
    }
}

/// JavaScript's `v >>> 0`: truncate toward zero, then mod 2³² (NaN/∞ → 0).
func jsUint32(_ v: Double) -> UInt32 {
    guard v.isFinite else { return 0 }
    let t = v.rounded(.towardZero).truncatingRemainder(dividingBy: 4_294_967_296)
    return UInt32(truncatingIfNeeded: Int64(t))
}

/// `normalizeSeed`: the seed a SpecInstance renders with (0 lands on 1).
func normalizedRenderSeed(_ seed: Int) -> UInt32 {
    let s = UInt32(truncatingIfNeeded: Int64(seed))
    return s == 0 ? 1 : s
}

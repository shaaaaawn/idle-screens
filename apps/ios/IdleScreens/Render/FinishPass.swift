import SwiftUI

/// The print `finish`: grain and an ordered-dither screen composited over the
/// finished frame as the last step (packages/schema/src/finish.ts). Both
/// tiles are zero-mean grey and screened with `overlay` at a small alpha, so
/// the frame's mean luminance is unchanged; the grain tile is seeded with
/// the field's lattice hash, so two screens at the same `t` show the same
/// grain. `FinishTests` pins the tiles and offsets against the TypeScript.
enum FinishTiles {
    static let grainTile = 256
    static let ditherTile = 8
    static let grainAlpha = 0.35
    static let ditherAlpha = 0.25
    static let animateHz = 12.0

    static func strength(_ f: SpecSubset.Finish?) -> (grain: Double, dither: Double) {
        func c(_ v: Double?) -> Double { Swift.min(1, Swift.max(0, v ?? 0)) }
        return (c(f?.grain), c(f?.dither))
    }

    /// Grey levels of the grain tile, row-major (`grainTilePixels`, one channel).
    static func grainLevels(seed: UInt32) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: grainTile * grainTile)
        var i = 0
        for y in 0..<grainTile {
            for x in 0..<grainTile {
                let v = (FieldSampler.latticeHash(Int64(x), Int64(y), seed)
                    + FieldSampler.latticeHash(Int64(x), Int64(y), seed &+ 0x5bd1_e995)) / 2
                out[i] = UInt8(clamping: Int(FieldSampler.jsRound(128 + (v - 0.5) * 255)))
                i += 1
            }
        }
        return out
    }

    /// The 8×8 Bayer matrix, values 0…63 (`bayerMatrix`).
    static func bayerMatrix() -> [[Int]] {
        var m: [[Int]] = [[0]]
        var n = 1
        while n < ditherTile {
            var next: [[Int]] = []
            for y in 0..<(n * 2) {
                var row: [Int] = []
                for x in 0..<(n * 2) {
                    let base = m[y % n][x % n] * 4
                    let quadrant = (y >= n ? 2 : 0) + (x >= n ? 1 : 0)
                    row.append(base + [0, 2, 3, 1][quadrant])
                }
                next.append(row)
            }
            m = next
            n *= 2
        }
        return m
    }

    /// Grey levels of the dither tile (`bayerTilePixels`, one channel).
    static func ditherLevels() -> [UInt8] {
        bayerMatrix().flatMap { row in
            row.map { UInt8(clamping: Int(FieldSampler.jsRound((Double($0) + 0.5) / Double(ditherTile * ditherTile) * 255))) }
        }
    }

    /// Where the grain tile sits at scene time `t` (ms): the origin, or with
    /// `animate` a seeded offset stepping at 12 Hz (`grainOffset`).
    static func grainOffset(t: Double, seed: UInt32, animate: Bool) -> (x: Int, y: Int) {
        guard animate else { return (0, 0) }
        let bucket = Int64((t * animateHz / 1000).rounded(.down))
        return (Int((FieldSampler.latticeHash(bucket, 1, seed) * Double(grainTile)).rounded(.down)),
                Int((FieldSampler.latticeHash(bucket, 2, seed) * Double(grainTile)).rounded(.down)))
    }

    // NSCache is thread-safe; its values are immutable images.
    nonisolated(unsafe) private static let cache = NSCache<NSString, CGImage>()

    static func grainImage(seed: UInt32) -> CGImage? {
        image(key: "grain|\(seed)", side: grainTile) { grainLevels(seed: seed) }
    }

    static func ditherImage() -> CGImage? {
        image(key: "dither", side: ditherTile) { ditherLevels() }
    }

    private static func image(key: String, side: Int, _ levels: () -> [UInt8]) -> CGImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        let grey = levels()
        var px = [UInt8](repeating: 255, count: side * side * 4)
        for (i, g) in grey.enumerated() { px[i * 4] = g; px[i * 4 + 1] = g; px[i * 4 + 2] = g }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let img = CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32,
                                bytesPerRow: side * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return nil }
        cache.setObject(img, forKey: key as NSString)
        return img
    }
}

/// The finish as a view laid over the whole composed frame (bed, segment and
/// any dissolve together, as the web presents it). The tiles are drawn at one
/// tile pixel per point and blended `overlay`, crisp (no smoothing).
struct FinishOverlay: View {
    let finish: SpecSubset.Finish
    /// Normalised render seed (`(seed >>> 0) || 1`).
    let seed: UInt32
    /// Animated grain steps at 12 Hz; the low tier keeps it static (the web's
    /// `basic` tier rule).
    var animateAllowed: Bool = true

    @State private var start = Date()

    var body: some View {
        let animate = animateAllowed && finish.animate == true
        Group {
            if animate {
                TimelineView(.periodic(from: .now, by: 1 / FinishTiles.animateHz)) { context in
                    canvas(t: context.date.timeIntervalSince(start) * 1000)
                }
            } else {
                canvas(t: 0)
            }
        }
        .blendMode(.overlay)
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    private func canvas(t: Double) -> some View {
        Canvas { ctx, size in
            let rect = CGRect(origin: .zero, size: size)
            let s = FinishTiles.strength(finish)
            if s.grain > 0, let tile = FinishTiles.grainImage(seed: seed) {
                let off = FinishTiles.grainOffset(t: t, seed: seed, animate: animateAllowed && finish.animate == true)
                var g = ctx
                g.opacity = s.grain * FinishTiles.grainAlpha
                g.fill(Path(rect), with: .tiledImage(Image(decorative: tile, scale: 1).interpolation(.none),
                                                     origin: CGPoint(x: -off.x, y: -off.y)))
            }
            if s.dither > 0, let tile = FinishTiles.ditherImage() {
                var d = ctx
                d.opacity = s.dither * FinishTiles.ditherAlpha
                d.fill(Path(rect), with: .tiledImage(Image(decorative: tile, scale: 1).interpolation(.none)))
            }
        }
    }
}

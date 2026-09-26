import Foundation
import CoreGraphics

/// Cheap, pure static analysis of a compiled scene: does it put any
/// perceptible ink on screen, or would it render as a black/blank rectangle?
/// Guards every rendering surface — posters fall back to generative art and
/// the fullscreen player shows a designed "not broadcasting" state instead
/// of an apparently-broken black screen.
enum SceneVisibility {

    enum Verdict: Equatable {
        case visible
        case invisible
    }

    /// Ink coverage threshold as a fraction of canvas area. Calibrated
    /// against the live catalog: sparse-but-visible scenes (lobby's lanterns)
    /// score well above it; sub-pixel or dark-on-dark scenes score near zero.
    private static let minInkFraction = 0.0004

    /// Above this luminance the background itself is doing the work: a
    /// visibly bright fill (or gradient) is not a black/blank tile no matter
    /// how sparse or dark-on-dark the layers drawn over it are.
    private static let brightBackgroundLuminance = 0.35

    static func verdict(layers: [CompiledLayer],
                        background: SpecSubset.Background?,
                        canvas: CGSize = CGSize(width: 1920, height: 1080)) -> Verdict {
        let canvasArea = canvas.width * canvas.height
        let bgLum = backgroundLuminance(background)
        if bgLum >= brightBackgroundLuminance { return .visible }
        let referenceLum = luminance(hex: background?.primaryColor ?? "000000")
        var ink = 0.0

        for layer in layers {
            let dim = layer.units == .px ? 1 : min(canvas.width, canvas.height)
            for entity in layer.entities {
                let area: Double
                switch layer.sprite {
                case .circle:
                    let r = entity.size * dim
                    guard r >= 0.5 else { continue }
                    area = .pi * r * r
                case .ring(_, _, _, let width):
                    let r = entity.size * dim
                    guard r >= 0.5 else { continue }
                    let w = max(1, (width ?? (layer.units == .px ? 2 : 0.002)) * dim)
                    area = 2 * .pi * r * w
                case .rect:
                    let w = entity.size * dim
                    guard w >= 0.5 else { continue }
                    area = w * w * entity.aspect
                case .streak(_, _, _, let width):
                    let length = entity.size * dim
                    guard length >= 0.5 else { continue }
                    area = length * max(1, (width ?? (layer.units == .px ? 2 : 0.002)) * dim)
                case .emoji:
                    // Emoji are full-color glyphs — ink regardless of contrast.
                    guard entity.size >= 4 else { continue }
                    ink += entity.size * entity.size * 0.5 * entity.alpha
                    continue
                case .text:
                    guard entity.size >= 4 else { continue }
                    let glyphs = Double(max(1, entity.glyph?.count ?? 1))
                    area = entity.size * entity.size * 0.55 * glyphs
                case .textBlock(let text, let maxWidth, let fontSize, let lineHeight, _, _, _):
                    let fsPx = fontSize * dim
                    guard fsPx >= 2 else { continue }
                    let lh = lineHeight * fsPx
                    let maxWPx = maxWidth * dim
                    let lineCount = breakTextBlock(text: text, maxWidthEm: maxWPx / fsPx).count
                    area = maxWPx * lh * Double(lineCount)
                case .polygon(_, _, _, let sides, let points, _):
                    let r = entity.size * dim
                    guard r >= 0.5 else { continue }
                    // Shoelace of the actual facet — a thin shard is not a disc.
                    let verts = NativeSceneView.polygonPoints(sides: sides, points: points, radius: r)
                    guard verts.count >= 3 else { continue }
                    var doubleArea = 0.0
                    for i in verts.indices {
                        let a = verts[i], b = verts[(i + 1) % verts.count]
                        doubleArea += a.x * b.y - b.x * a.y
                    }
                    area = abs(doubleArea) / 2
                case .stroke(_, let points, _, _, let width, let smooth, _, _):
                    let length = entity.size * dim
                    guard length >= 0.5 else { continue }
                    // Ink is the sampled path's real length × its width, so a
                    // curled mark counts for more than its bounding box.
                    let samples = NativeSceneView.strokeSamples(points: points,
                                                                halfSize: length / 2,
                                                                smooth: smooth)
                    var pathLength = 0.0
                    for i in 1..<max(1, samples.count) {
                        pathLength += hypot(samples[i].x - samples[i - 1].x,
                                            samples[i].y - samples[i - 1].y)
                    }
                    guard pathLength > 0 else { continue }
                    area = pathLength * max(1, (width ?? (layer.units == .px ? 2 : 0.002)) * dim)
                case .bar(let values, _, _, _, _, let maxValue, _):
                    let len = entity.size * dim
                        * NativeSceneView.barFraction(values: values, max: maxValue,
                                                      index: entity.barIndex)
                    guard len >= 0.5 else { continue }
                    let thick = entity.thickness > 0 ? entity.thickness * dim : entity.size * dim * 0.2
                    area = len * max(1, thick)
                case .unknown:
                    continue
                }
                // Dark-on-dark is as invisible as sub-pixel: weight by
                // luminance contrast against the background.
                // Contrast is measured against the gradient's FIRST stop, the
                // reference `minInkFraction` was calibrated on. `bgLum` above
                // is the BRIGHTEST stop — right for "is the fill itself
                // bright?", wrong here: one warm stop at the foot of a night
                // gradient dragged every lantern's contrast down and a
                // working channel was shown as "not broadcasting".
                let contrast = abs(luminance(hex: entity.color) - referenceLum)
                ink += min(area, canvasArea * 0.04) * entity.alpha * contrast
            }
        }

        return ink / canvasArea >= minInkFraction ? .visible : .invisible
    }

    /// Brightest color the background actually paints: the solid fill, the
    /// brightest of ALL gradient stops, or the brightest `field` band.
    /// `Background.primaryColor` only looks at the first stop (or the solid
    /// color, or the middle band) — fine for a placeholder tint, but it
    /// misses a bright stop/band elsewhere, which is exactly the case that
    /// lights up an otherwise sparse/dark-on-dark scene.
    private static func backgroundLuminance(_ background: SpecSubset.Background?) -> Double {
        guard let background else { return 0 }
        if let color = background.color { return luminance(hex: color) }
        if let stops = background.stops, !stops.isEmpty {
            return stops.map { luminance(hex: $0.color) }.max() ?? 0
        }
        // `field` backgrounds carry no `color`/`stops` — only `bands` — so
        // without this branch a bright field (e.g. a light noise band) never
        // takes the fast path above and a sparse/dark-on-dark scene over it
        // reads as "not broadcasting" the same way the gradient bug did.
        guard let bands = background.bands, !bands.isEmpty else { return 0 }
        return bands.map { luminance(hex: $0) }.max() ?? 0
    }

    /// Relative luminance (0…1) of a hex color, gamma-naive — fine for a
    /// coarse contrast heuristic.
    static func luminance(hex: String) -> Double {
        let cleaned = hex.trimmingCharacters(in: .alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}

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

    static func verdict(layers: [CompiledLayer],
                        background: SpecSubset.Background?,
                        canvas: CGSize = CGSize(width: 1920, height: 1080)) -> Verdict {
        let canvasArea = canvas.width * canvas.height
        let bgLum = luminance(hex: background?.primaryColor ?? "000000")
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
                case .unknown:
                    continue
                }
                // Dark-on-dark is as invisible as sub-pixel: weight by
                // luminance contrast against the background.
                let contrast = abs(luminance(hex: entity.color) - bgLum)
                // Cap any single entity at 4% of the canvas so one giant dim
                // wash can't carry an otherwise-empty scene.
                ink += min(area, canvasArea * 0.04) * entity.alpha * contrast
            }
        }

        return ink / canvasArea >= minInkFraction ? .visible : .invisible
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

import Foundation
import CoreGraphics

/// Analytic entity kinematics, shared by every renderer (SwiftUI Canvas and
/// SpriteKit). Pure functions of (entity, t) — port of the web engine's
/// simulate.ts (positionAt / sizeAt / rotationAt). Keeping the math in one
/// place is what guarantees the renderers agree with each other and the web.
enum SceneMotion {

    /// Position in view pixels at time `t` (seconds). `dim` is the
    /// units-scale (1 for px specs, min(w,h) for viewport specs).
    static func position(of entity: CompiledEntity, at t: TimeInterval,
                         in size: CGSize, dim: CGFloat, wrap: Bool) -> CGPoint {
        let x0 = entity.x * size.width
        let y0 = entity.y * size.height
        let m = entity.size * dim
        let tms = t * 1000

        switch entity.motionType {
        case "static":
            return CGPoint(x: x0, y: y0)

        case "orbit":
            // vx carries angular speed in deg/sec; phase seeds the start angle.
            let angle = entity.phase + entity.vx * .pi / 180 * t
            return CGPoint(
                x: entity.orbitCx * size.width + entity.orbitR * dim * cos(angle),
                y: entity.orbitCy * size.height + entity.orbitR * dim * sin(angle))

        case "bounce":
            return CGPoint(
                x: reflect(x0 + entity.vx * dim * t, m / 2, size.width - m / 2),
                y: reflect(y0 + entity.vy * dim * t, m / 2, size.height - m / 2))

        case "rise":
            let sway = entity.bob != 0 ? entity.bob * dim * sin(tms / 700 + entity.phase) : 0
            return CGPoint(
                x: x0 + sway,
                y: wrapValue(y0 + entity.vy * dim * t, -m, size.height + m))

        case "wander" where entity.wander != nil:
            let w = entity.wander!
            let c = w.coherence
            var hx = 0.0, hy = 0.0
            for i in 0..<3 {
                if c < 1 {
                    hx += (1 - c) * w.ax[i] * dim * sin(w.fx[i] * tms + w.phx[i])
                    hy += (1 - c) * w.ay[i] * dim * sin(w.fy[i] * tms + w.phy[i])
                }
                if c > 0 {
                    hx += c * w.sharedAx[i] * dim * sin(w.sharedFx[i] * tms + w.sharedPhx[i])
                    hy += c * w.sharedAy[i] * dim * sin(w.sharedFy[i] * tms + w.sharedPhy[i])
                }
            }
            let margin = m + w.margin * dim
            return CGPoint(
                x: wrapValue(x0 + entity.vx * dim * t + hx, -margin, size.width + margin),
                y: wrapValue(y0 + entity.vy * dim * t + hy, -margin, size.height + margin))

        default:  // drift + unknown
            let bobX = entity.bob != 0 ? entity.bob * dim * sin(tms / 700 + entity.phase) : 0
            var px = x0 + entity.vx * dim * t + bobX
            var py = y0 + entity.vy * dim * t
            if wrap {
                px = px.truncatingRemainder(dividingBy: size.width)
                if px < 0 { px += size.width }
                py = py.truncatingRemainder(dividingBy: size.height)
                if py < 0 { py += size.height }
            } else {
                px = min(size.width, max(0, px))
                py = min(size.height, max(0, py))
            }
            return CGPoint(x: px, y: py)
        }
    }

    /// Size multiplier for grow (size breathing) at time `t` (seconds).
    /// 1 when the layer declares no grow. Clamped positive like sizeAt().
    static func growScale(of entity: CompiledEntity, at t: TimeInterval) -> Double {
        guard entity.growAmp != 0 else { return 1 }
        let s = 1 + entity.growAmp * sin(t * 1000 * 2 * .pi / entity.growPeriod + entity.growPhase)
        return max(s, 0.01)
    }

    /// Rotation in degrees at time `t` (seconds). 0 for non-spinning entities.
    static func rotationDegrees(of entity: CompiledEntity, at t: TimeInterval) -> Double {
        guard entity.spinSpeed != 0 else { return 0 }
        return entity.spinAngle + entity.spinSpeed * t
    }

    /// Pulse alpha at time `t` (seconds), matching the Canvas renderer.
    static func pulsedAlpha(of entity: CompiledEntity, layer: CompiledLayer,
                            at t: TimeInterval) -> Double {
        var alpha = entity.alpha
        if let pulse = layer.pulse {
            let wave = sin(2 * .pi * (t * 1000 / pulse.period) + entity.phase)
            alpha = min(1, max(0, alpha * (1 + pulse.amp * wave)))
        }
        return alpha
    }

    /// Web engine's wrap(): cyclic wrap of v into [lo, hi).
    static func wrapValue(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        let range = hi - lo
        guard range > 0 else { return lo }
        return (((v - lo).truncatingRemainder(dividingBy: range)) + range)
            .truncatingRemainder(dividingBy: range) + lo
    }

    /// Web engine's reflect(): ping-pong of v between lo and hi.
    static func reflect(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        let range = hi - lo
        guard range > 0 else { return lo }
        let period = range * 2
        var p = (v - lo).truncatingRemainder(dividingBy: period)
        if p < 0 { p += period }
        return p < range ? lo + p : hi - (p - range)
    }
}

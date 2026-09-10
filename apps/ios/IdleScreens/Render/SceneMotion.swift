import Foundation
import CoreGraphics

/// Analytic entity kinematics, shared by every renderer (SwiftUI Canvas and
/// SpriteKit). Pure functions of (entity, t) — port of the web engine's
/// simulate.ts (positionAt / sizeAt / rotationAt). Keeping the math in one
/// place is what guarantees the renderers agree with each other and the web.
enum SceneMotion {

    /// Position in view pixels at time `t` (seconds). `dim` is the
    /// units-scale (1 for px specs, min(w,h) for viewport specs).
    /// `parent` is the entity a parented orbit rides (see CompiledLayer's
    /// `orbitParentKey`): the child's own position is an offset from (0,0),
    /// so the two move as one body.
    static func position(of entity: CompiledEntity, at t: TimeInterval,
                         in size: CGSize, dim: CGFloat, wrap: Bool,
                         parent: CompiledEntity? = nil) -> CGPoint {
        if entity.orbitParented, let parent {
            let offset = position(of: entity, at: t, in: size, dim: dim, wrap: wrap)
            let anchor = position(of: parent, at: t, in: size, dim: dim, wrap: wrap)
            return CGPoint(x: offset.x + anchor.x, y: offset.y + anchor.y)
        }
        return basePosition(of: entity, at: t, in: size, dim: dim, wrap: wrap)
    }

    private static func basePosition(of entity: CompiledEntity, at t: TimeInterval,
                                     in size: CGSize, dim: CGFloat, wrap: Bool) -> CGPoint {
        let x0 = entity.x * size.width
        let y0 = entity.y * size.height
        let m = entity.size * dim
        let tms = t * 1000

        switch entity.motionType {
        case "static":
            return CGPoint(x: x0, y: y0)

        case "warp" where entity.warp != nil:
            // Flying at the viewer: depth wraps far→near, and screen offset
            // from the vanishing point scales by the same 1/z as the sprite.
            let w = entity.warp!
            let persp = 1 / warpDepth(w, at: t)
            let halfMin = Swift.min(size.width, size.height) / 2
            return CGPoint(x: w.cx * size.width + w.ux * halfMin * persp,
                           y: w.cy * size.height + w.uy * halfMin * persp)

        case "path" where entity.path != nil:
            let p = entity.path!
            let pt = pathPoint(p, at: t, in: size)
            return CGPoint(x: pt.x + p.offX * dim, y: pt.y + p.offY * dim)

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
            // Web parity, corrected on four counts (simulate.ts, end of
            // positionAt): the wrap range is the viewport plus a one-sprite
            // MARGIN, so a sprite glides off the edge and returns instead of
            // popping at x=0; y only wraps when the entity actually has
            // vertical velocity; `bob` offsets Y (not X) on a 500ms period —
            // rise is the one that sways horizontally, on 700; and a layer
            // with wrapping disabled simply leaves, rather than being clamped
            // to the border where sprites pile up in a line.
            let rawX = x0 + entity.vx * dim * t
            let px = wrap ? wrapValue(rawX, -m, size.width + m) : rawX
            let rawY = y0 + entity.vy * dim * t
            var py = (wrap && entity.vy != 0)
                ? wrapValue(rawY, -m, size.height + m)
                : rawY
            if entity.bob != 0 {
                py += entity.bob * dim * sin(tms / 500 + entity.phase)
            }
            return CGPoint(x: px, y: py)
        }
    }

    /// Near plane for warp depth; z lives in [warpNear, 1] and screen scale
    /// is 1/z (web parity: simulate.ts WARP_NEAR).
    static let warpNear = 0.08
    private static let warpMaxScale = 8.0

    /// Depth of a warp entity at `t` (seconds): wraps from far (1) to near.
    static func warpDepth(_ w: WarpParams, at t: TimeInterval) -> Double {
        wrapValue(w.z0 - w.vz * t, warpNear, 1)
    }

    /// Position along a path loop at `t` (seconds), in view pixels. Closed
    /// loops cycle; open ones ping-pong so they reverse instead of teleporting.
    static func pathPoint(_ p: PathParams, at t: TimeInterval, in size: CGSize) -> CGPoint {
        let n = p.points.count
        guard n >= 2 else {
            let only = p.points.first ?? (x: 0.5, y: 0.5)
            return CGPoint(x: only.x * size.width, y: only.y * size.height)
        }
        var s = (t * 1000 / p.duration + p.phase).truncatingRemainder(dividingBy: 1)
        if s < 0 { s += 1 }
        if !p.closed {
            let pp = s * 2
            s = pp < 1 ? pp : 2 - pp
        }
        let segs = Double(p.closed ? n : n - 1)
        let u = Swift.min(s * segs, segs - 1e-9)
        let i = Int(u.rounded(.down))
        let local = u - Double(i)
        func at(_ k: Int) -> (x: Double, y: Double) {
            p.closed ? p.points[((k % n) + n) % n]
                     : p.points[Swift.max(0, Swift.min(n - 1, k))]
        }
        let p1 = at(i), p2 = at(i + 1)
        let fx: Double, fy: Double
        if p.smooth {
            let p0 = at(i - 1), p3 = at(i + 2)
            fx = catmullRom(p0.x, p1.x, p2.x, p3.x, local)
            fy = catmullRom(p0.y, p1.y, p2.y, p3.y, local)
        } else {
            fx = p1.x + (p2.x - p1.x) * local
            fy = p1.y + (p2.y - p1.y) * local
        }
        return CGPoint(x: fx * size.width, y: fy * size.height)
    }

    static func catmullRom(_ p0: Double, _ p1: Double, _ p2: Double,
                           _ p3: Double, _ u: Double) -> Double {
        let u2 = u * u, u3 = u2 * u
        return 0.5 * (2 * p1 + (-p0 + p2) * u
                      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
                      + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
    }

    /// Size multiplier for grow (size breathing) at time `t` (seconds).
    /// 1 when the layer declares no grow. Clamped positive like sizeAt().
    /// Warp entities also scale by 1/z as they approach the viewer.
    static func growScale(of entity: CompiledEntity, at t: TimeInterval) -> Double {
        var s = 1.0
        if entity.growAmp != 0 {
            s = 1 + entity.growAmp * sin(t * 1000 * 2 * .pi / entity.growPeriod + entity.growPhase)
        }
        if let w = entity.warp {
            s *= Swift.min(1 / warpDepth(w, at: t), warpMaxScale)
        }
        if let emit = entity.emit, emit.growFrom != 1 || emit.growTo != 1,
           let u = emit.window(at: t) {
            s *= emit.growFrom + (emit.growTo - emit.growFrom) * u
        }
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
        // Pulse is ADDITIVE in the web engine (`alpha + amp·sin`), not a
        // percentage of the base alpha. Multiplying shrank every pulse to a
        // fraction of its authored swing — at alpha 0.5, amp 0.4 the web
        // breathes 0.1…0.9 where this used to manage 0.3…0.7.
        var alpha = entity.alpha
        if let pulse = layer.pulse, pulse.amp != 0 {
            alpha += pulse.amp * sin(2 * .pi * (t * 1000 / pulse.period) + entity.phase)
        }
        if let w = entity.warp {
            // Fade in over the first 20% of depth after respawning at the far
            // plane, so a recycled entity doesn't pop into view.
            let z = warpDepth(w, at: t)
            alpha *= Swift.min(1, Swift.max(0, (1 - z) / 0.2))
        }
        if let emit = entity.emit {
            // Sparse events: absent between appearances, and shaped by an
            // attack/decay envelope while present.
            guard let u = emit.window(at: t) else { return 0 }
            alpha *= EmitParams.envelope(u)
        }
        return Swift.min(1, Swift.max(0, alpha))
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

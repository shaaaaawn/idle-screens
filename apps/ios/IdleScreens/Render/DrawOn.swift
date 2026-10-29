import CoreGraphics
import Foundation

/// `draw: {start, end}` on a stroke sprite or a path drawing's stroke: only
/// the stretch between those arc-length fractions is painted, so gliding
/// `end` 0 → 1 draws the line on like a pen and gliding `start` after it
/// erases it from the tail. A port of shapes.ts `drawSpan` / `trimPolyline` /
/// `trimLines`; `DrawOnTests` pins it to the TypeScript.
struct StrokeDraw: Codable, Equatable, Sendable {
    var start: Double?
    var end: Double?
    /// `"each"`: every subpath of a drawing draws over the whole span at
    /// once; anything else (`"run"`, the default) is one pen run.
    var mode: String?

    var each: Bool { mode == "each" }

    /// The clamped [start, end] span, or nil when it paints the whole line.
    var span: (Double, Double)? {
        let a = max(0, min(1, start ?? 0)), b = max(0, min(1, end ?? 1))
        return a <= 0 && b >= 1 ? nil : (a, b)
    }
}

enum DrawOn {
    static func length(_ pts: [CGPoint]) -> Double {
        var l = 0.0
        for i in pts.indices.dropFirst() { l += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) }
        return l
    }

    /// The polyline between arc-length fractions `a` and `b` (empty when b ≤ a).
    static func trim(_ pts: [CGPoint], _ a: Double, _ b: Double) -> [CGPoint] {
        guard pts.count >= 2, b > a else { return [] }
        let total = length(pts)
        guard total > 0 else { return [] }
        let from = a * total, to = b * total
        var out: [CGPoint] = []
        var run = 0.0
        for i in 1..<pts.count {
            let p = pts[i - 1], q = pts[i]
            let seg = hypot(q.x - p.x, q.y - p.y)
            let s0 = run, s1 = run + seg
            run = s1
            if s1 < from || seg <= 0 { continue }
            if s0 > to { break }
            func at(_ s: Double) -> CGPoint {
                let k = max(0, min(1, (s - s0) / seg))
                return CGPoint(x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k)
            }
            if out.isEmpty { out.append(s0 >= from ? p : at(from)) }
            out.append(s1 <= to ? q : at(to))
            if s1 >= to { break }
        }
        return out.count >= 2 ? out : []
    }

    /// A drawing's subpaths cut to a span as one pen run in draw order (a
    /// closed ring counts its closing edge; a cut ring comes back open) — or,
    /// with `each`, every subpath cut to the same fractions of its own length.
    static func trim(_ lines: [PathGeometry.Line], _ a: Double, _ b: Double, each: Bool = false) -> [PathGeometry.Line] {
        func pts(_ l: PathGeometry.Line) -> [CGPoint] {
            var p = l.points.map { CGPoint(x: $0.0, y: $0.1) }
            if l.closed, p.count > 1 { p.append(p[0]) }
            return p
        }
        let lens = lines.map { length(pts($0)) }
        if each {
            guard b > a else { return [] }
            var out: [PathGeometry.Line] = []
            for (i, l) in lines.enumerated() where lens[i] > 0 {
                if a <= 0, b >= 1 { out.append(l); continue }
                let cut = trim(pts(l), a, b)
                if cut.count >= 2 { out.append(PathGeometry.Line(points: cut.map { (Double($0.x), Double($0.y)) }, closed: false)) }
            }
            return out
        }
        let total = lens.reduce(0, +)
        guard total > 0, b > a else { return [] }
        let from = a * total, to = b * total
        var out: [PathGeometry.Line] = []
        var run = 0.0
        for (i, l) in lines.enumerated() {
            let len = lens[i], s0 = run
            run += len
            if len <= 0 || run < from || s0 > to { continue }
            if s0 >= from, run <= to { out.append(l); continue }
            let cut = trim(pts(l), (max(from, s0) - s0) / len, (min(to, run) - s0) / len)
            if cut.count >= 2 { out.append(PathGeometry.Line(points: cut.map { (Double($0.x), Double($0.y)) }, closed: false)) }
        }
        return out
    }
}

import CoreGraphics
import Foundation
import UIKit

/// A `polygon` drawn from SVG paths — `path` (one part) or `parts` (a
/// multi-colour drawing) — with the web engine's paint: fill rule, gradient
/// (drawing box or `units: 'part'`), stroke, `fill: false`, per-part opacity,
/// and the `span` / `origin` frame. Mirrors packages/schema `pathParts` /
/// `pathFrame` / compile.ts `drawPathUnit`. Both native tiers draw it the same
/// way: rasterised once per (drawing, colour, size) by `PathRaster`, then
/// placed per entity — the web engine's render-once cache, which the Canvas
/// tier needs most (it otherwise refills every path every frame).
final class PathDrawing: Equatable, @unchecked Sendable {
    struct Stop: Codable, Equatable { var at: Double; var color: String; var opacity: Double? }
    struct Gradient: Codable, Equatable {
        var type: String
        var from: [Double]?
        var to: [Double]?
        var center: [Double]?
        var radius: Double?
        var focus: [Double]?
        var units: String?
        var stops: [Stop]
    }
    struct Stroke: Codable, Equatable {
        var color: String
        var width: Double
        var opacity: Double?
        var join: String?
        var cap: String?
        /// Draw-on: only this arc-length span of the part's lines is stroked.
        var draw: StrokeDraw?
    }
    struct PartSpec: Codable, Equatable {
        var path: String
        var color: String?
        var fillRule: String?
        var fill: Bool?
        var gradient: Gradient?
        var stroke: Stroke?
        var opacity: Double?
    }

    struct Part {
        let flat: PathGeometry.Flattened
        /// Its own colour, or nil for the entity's (palette pick).
        let color: String?
        let fill: Bool
        let evenOdd: Bool
        let gradient: Gradient?
        let stroke: Stroke?
        let opacity: Double
        /// The fill's box in the unit box (centre + half extents): `units: 'part'` space.
        let box: (cx: Double, cy: Double, hw: Double, hh: Double)
    }

    /// Stable content key (cache key part).
    let key: String
    let parts: [Part]
    let span: String
    let origin: (Double, Double)
    /// `soft` applies to a single-path drawing without a gradient (shapes.ts parity).
    let soft: Bool

    init(specs: [PartSpec], ownColor: Bool, span: String?, origin: [Double]?, soft: Bool) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        let body = (try? enc.encode(specs)).flatMap { String(data: $0, encoding: .utf8) } ?? UUID().uuidString
        self.key = "\(body)|\(span ?? "box")|\(origin ?? [0, 0])|\(soft)"
        self.span = span ?? "box"
        self.origin = (origin?.first ?? 0, origin?.dropFirst().first ?? 0)
        self.soft = soft
        self.parts = specs.map { s in
            let rule = PathGeometry.FillRule(rawValue: s.fillRule ?? "auto") ?? .auto
            let flat = PathGeometry.flatten(s.path, rule: rule)
            let pts = flat.points.isEmpty ? flat.lines.flatMap(\.points) : flat.points
            var x0 = Double.infinity, x1 = -Double.infinity, y0 = Double.infinity, y1 = -Double.infinity
            for (x, y) in pts { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y) }
            if !x0.isFinite { x0 = -1; x1 = 1; y0 = -1; y1 = 1 }
            return Part(flat: flat, color: ownColor ? s.color : nil, fill: s.fill != false,
                        evenOdd: rule == .evenodd, gradient: s.gradient, stroke: s.stroke,
                        opacity: s.opacity ?? 1,
                        box: ((x0 + x1) / 2, (y0 + y1) / 2, max((x1 - x0) / 2, 1e-6), max((y1 - y0) / 2, 1e-6)))
        }
    }

    static func == (a: PathDrawing, b: PathDrawing) -> Bool { a.key == b.key }

    /// pathFrame: per-axis scale (px) and the unit-box point anchored at the position.
    func frame(r: Double, width: Double, height: Double) -> (sx: Double, sy: Double, ox: Double, oy: Double) {
        let sx = span == "width" || span == "screen" ? width / 2 : r
        let sy = span == "height" || span == "screen" ? height / 2 : r
        return (sx, sy, origin.0, origin.1)
    }

    /// Filled area in px² (union-free: parts summed) — SceneVisibility's ink.
    func area(r: Double, width: Double, height: Double) -> Double {
        let f = frame(r: r, width: width, height: height)
        var a = 0.0
        for p in parts {
            if p.fill { a += abs(PathGeometry.signedArea(p.flat.points)) * f.sx * f.sy * p.opacity }
            if let st = p.stroke {
                for l in p.flat.lines {
                    var len = 0.0
                    for i in 1..<max(1, l.points.count) {
                        len += hypot((l.points[i].0 - l.points[i - 1].0) * f.sx, (l.points[i].1 - l.points[i - 1].1) * f.sy)
                    }
                    a += len * st.width * r * (st.opacity ?? 1) * p.opacity
                }
            }
        }
        return a
    }
}

/// Rasterises a `PathDrawing` once per (drawing, colour, frame) and hands back
/// the bitmap plus where the entity's position sits in it. Shared by the
/// Canvas tier (drawn as an Image) and the SpriteKit tier (an SKTexture).
enum PathRaster {
    struct Raster {
        let image: CGImage
        /// The entity's position inside the image, px from the top-left.
        let anchor: CGPoint
        /// Image px per point.
        let scale: CGFloat
    }

    // NSCache is thread-safe; its values are immutable rasters.
    nonisolated(unsafe) private static let cache = NSCache<NSString, RasterBox>()
    private final class RasterBox { let r: Raster; init(_ r: Raster) { self.r = r } }

    /// Longest image side, px — a screen-spanning drawing at 4K stays bounded.
    static let maxSide: CGFloat = 4096

    /// `r` in points; `scale` px per point (the screen's scale).
    static func raster(_ d: PathDrawing, color: String, r: Double, width: Double, height: Double,
                       scale: CGFloat = 2) -> Raster? {
        guard r > 0 else { return nil }
        // Uniform drawings snap their radius up to a 1/8-octave step so a
        // grow/pulse does not re-rasterise every frame (they are shrunk, never
        // enlarged, when drawn); stretched spans key on the exact frame.
        let fr0 = d.frame(r: r, width: width, height: height)
        let uniform = d.span == "box"
        let rKey = uniform ? pow(2, ceil(log2(max(r, 0.5)) * 8) / 8) : r
        let fr = uniform ? (sx: rKey, sy: rKey, ox: fr0.ox, oy: fr0.oy) : fr0
        let key = "\(d.key)|\(color)|\(String(format: "%.2f|%.2f|%.2f", fr.sx, fr.sy, rKey))|\(scale)" as NSString
        if let hit = cache.object(forKey: key) { return hit.r }

        // Bounds in points (unit → frame), padded for strokes.
        var x0 = Double.infinity, x1 = -Double.infinity, y0 = Double.infinity, y1 = -Double.infinity
        var sw = 0.0
        func grow(_ u: PathGeometry.Pt) {
            let x = (u.0 - fr.ox) * fr.sx, y = (u.1 - fr.oy) * fr.sy
            x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
        }
        for p in d.parts {
            if p.fill { p.flat.points.forEach(grow) }
            if let st = p.stroke { sw = max(sw, st.width); p.flat.lines.forEach { $0.points.forEach(grow) } }
        }
        guard x0.isFinite else { return nil }
        let pad = 2 + sw * rKey
        x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
        var s = scale
        let longest = CGFloat(max(x1 - x0, y1 - y0)) * s
        if longest > maxSide { s *= maxSide / longest }
        let pw = Int(ceil(CGFloat(x1 - x0) * s)), ph = Int(ceil(CGFloat(y1 - y0) * s))
        guard pw > 0, ph > 0 else { return nil }

        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = false
        let img = UIGraphicsImageRenderer(size: CGSize(width: pw, height: ph), format: fmt).image { ctx in
            let cg = ctx.cgContext
            // Points → px, with the entity position at (-x0, -y0) points.
            cg.scaleBy(x: s, y: s)
            cg.translateBy(x: CGFloat(-x0), y: CGFloat(-y0))
            draw(d, in: cg, color: color, fr: fr, r: rKey)
        }
        guard let cgImage = img.cgImage else { return nil }
        let out = Raster(image: cgImage, anchor: CGPoint(x: CGFloat(-x0) * s, y: CGFloat(-y0) * s), scale: s)
        cache.setObject(RasterBox(out), forKey: key)
        return out
    }

    /// drawPathUnit: parts back to front, the entity position at the context origin.
    static func draw(_ d: PathDrawing, in cg: CGContext, color: String,
                     fr: (sx: Double, sy: Double, ox: Double, oy: Double), r: Double) {
        let toPx = { (u: PathGeometry.Pt) -> CGPoint in CGPoint(x: (u.0 - fr.ox) * fr.sx, y: (u.1 - fr.oy) * fr.sy) }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        func cgColor(_ hex: String, _ a: Double = 1) -> CGColor { UIColor(hexString: hex).withAlphaComponent(CGFloat(a)).cgColor }
        for p in d.parts {
            let pc = p.color ?? color
            if p.fill, p.flat.points.count >= 3 {
                let path = CGMutablePath()
                path.addLines(between: p.flat.points.map(toPx))
                path.closeSubpath()
                cg.saveGState()
                cg.setAlpha(CGFloat(p.opacity))
                if let gr = p.gradient {
                    cg.addPath(path)
                    if p.evenOdd { cg.clip(using: .evenOdd) } else { cg.clip() }
                    let colors = gr.stops.map { cgColor($0.color, $0.opacity ?? 1) } as CFArray
                    var locs = gr.stops.map { CGFloat($0.at) }
                    if let g = CGGradient(colorsSpace: space, colors: colors, locations: &locs) {
                        // Gradient space → px: the drawing's unit box through the frame,
                        // or (units 'part') the part's own box as −1..1.
                        var m = CGAffineTransform(a: fr.sx, b: 0, c: 0, d: fr.sy, tx: -fr.ox * fr.sx, ty: -fr.oy * fr.sy)
                        if gr.units == "part" {
                            m = CGAffineTransform(a: p.box.hw, b: 0, c: 0, d: p.box.hh, tx: p.box.cx, ty: p.box.cy).concatenating(m)
                        }
                        cg.concatenate(m)
                        let pad: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]
                        if gr.type == "radial", let c = gr.center, c.count >= 2, let rad = gr.radius {
                            let f = (gr.focus?.count ?? 0) >= 2 ? gr.focus! : c
                            cg.drawRadialGradient(g, startCenter: CGPoint(x: f[0], y: f[1]), startRadius: 0,
                                                  endCenter: CGPoint(x: c[0], y: c[1]), endRadius: rad, options: pad)
                        } else if let a = gr.from, let b = gr.to, a.count >= 2, b.count >= 2 {
                            cg.drawLinearGradient(g, start: CGPoint(x: a[0], y: a[1]), end: CGPoint(x: b[0], y: b[1]), options: pad)
                        }
                    }
                } else if d.soft && d.parts.count == 1 {
                    cg.addPath(path)
                    cg.clip()
                    let colors = [cgColor(pc), cgColor(pc, 0.75), cgColor(pc, 0)] as CFArray
                    var locs: [CGFloat] = [0, 0.35, 1]
                    if let g = CGGradient(colorsSpace: space, colors: colors, locations: &locs) {
                        cg.drawRadialGradient(g, startCenter: .zero, startRadius: 0, endCenter: .zero,
                                              endRadius: CGFloat(r), options: [])
                    }
                } else {
                    cg.setFillColor(cgColor(pc))
                    cg.addPath(path)
                    cg.fillPath(using: p.evenOdd ? .evenOdd : .winding)
                }
                cg.restoreGState()
            }
            let lines = p.stroke?.draw?.span.map { DrawOn.trim(p.flat.lines, $0.0, $0.1) } ?? p.flat.lines
            if let st = p.stroke, !lines.isEmpty {
                // Strokes in px: width from the uniform radius, never stretched by a span.
                let path = CGMutablePath()
                for l in lines where l.points.count >= 2 {
                    path.addLines(between: l.points.map(toPx))
                    if l.closed { path.closeSubpath() }
                }
                cg.saveGState()
                cg.setAlpha(CGFloat(p.opacity * (st.opacity ?? 1)))
                cg.setStrokeColor(cgColor(st.color))
                cg.setLineWidth(CGFloat(st.width * r))
                cg.setLineJoin(st.join == "miter" ? .miter : st.join == "bevel" ? .bevel : .round)
                cg.setLineCap(st.cap == "butt" ? .butt : st.cap == "square" ? .square : .round)
                cg.addPath(path)
                cg.strokePath()
                cg.restoreGState()
            }
        }
    }
}

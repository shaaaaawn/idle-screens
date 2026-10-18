import Foundation

/// Port of the path half of packages/schema/src/shapes.ts — `flattenPath` and
/// everything under it — so the native tiers draw a `polygon.path` / `parts`
/// drawing from the same outline the web engine fills. Kept line-for-line
/// close to the TypeScript (same tolerance, segment counts, simplification,
/// hole rules and bridge order); `PathParityTests` pins it against goldens
/// dumped from the TS (Fixtures/paths-golden.json).
enum PathGeometry {
    typealias Pt = (Double, Double)

    /// Flattening tolerance, unit-box units (shapes.ts PATH_TOLERANCE).
    static let tolerance = 0.0005

    enum FillRule: String { case auto, nonzero, evenodd }

    struct Line { var points: [Pt]; var closed: Bool }

    struct Flattened {
        /// One closed ring: subpaths joined by zero-width bridges, holes wound per the rule.
        var points: [Pt]
        var subpaths: Int
        /// Every subpath as drawn (simplified, no bridges), for strokes.
        var lines: [Line]
        var error: String?
    }

    // MARK: - Cache

    // Guarded by `lock` (Canvas and SpriteKit tiers may flatten from different threads).
    nonisolated(unsafe) private static var cache: [String: Flattened] = [:]
    private static let lock = NSLock()

    static func flatten(_ d: String, rule: FillRule = .auto) -> Flattened {
        let key = "\(rule.rawValue)|\(d)"
        lock.lock()
        if let hit = cache[key] { lock.unlock(); return hit }
        lock.unlock()
        let out: Flattened
        do {
            let parsed = try parseAndFlatten(d)
            let rings = parsed.rings.map(simplifyRing).filter { $0.count >= 3 }
            let lines = parsed.lines.map { Line(points: $0.closed ? simplifyRing($0.points) : simplifyLine($0.points), closed: $0.closed) }
            out = Flattened(points: rule == .auto ? joinRings(rings) : bridge(rings), subpaths: rings.count, lines: lines, error: nil)
        } catch {
            out = Flattened(points: [], subpaths: 0, lines: [], error: "\(error)")
        }
        lock.lock()
        if cache.count > 256 { cache.removeAll() }
        cache[key] = out
        lock.unlock()
        return out
    }

    // MARK: - Parse + flatten

    private enum ParseError: Error { case expectedNumber, mustStartWithM, unsupported(String) }

    /// The tokenizer of the TS regex `[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`.
    static func tokenize(_ d: String) -> [String] {
        var out: [String] = []
        let s = Array(d.unicodeScalars)
        var i = 0
        func isDigit(_ c: Unicode.Scalar) -> Bool { c.value >= 48 && c.value <= 57 }
        func isAlpha(_ c: Unicode.Scalar) -> Bool { (c.value >= 65 && c.value <= 90) || (c.value >= 97 && c.value <= 122) }
        while i < s.count {
            let c = s[i]
            if isAlpha(c) { out.append(String(c)); i += 1; continue }
            // A number: optional sign, then digits[.digits] or .digits, then optional exponent.
            var j = i
            if s[j] == "-" || s[j] == "+" { j += 1 }
            let numStart = j
            var matched = false
            if j < s.count, isDigit(s[j]) {
                while j < s.count, isDigit(s[j]) { j += 1 }
                if j < s.count, s[j] == "." { j += 1; while j < s.count, isDigit(s[j]) { j += 1 } }
                matched = true
            } else if j < s.count, s[j] == ".", j + 1 < s.count, isDigit(s[j + 1]) {
                j += 1
                while j < s.count, isDigit(s[j]) { j += 1 }
                matched = true
            }
            if matched {
                if j < s.count, s[j] == "e" || s[j] == "E" {
                    var k = j + 1
                    if k < s.count, s[k] == "-" || s[k] == "+" { k += 1 }
                    if k < s.count, isDigit(s[k]) {
                        while k < s.count, isDigit(s[k]) { k += 1 }
                        j = k
                    }
                }
                _ = numStart
                out.append(String(String.UnicodeScalarView(s[i..<j])))
                i = j
            } else {
                i += 1 // separators and anything the regex does not match
            }
        }
        return out
    }

    private static func segmentsFor(chord: Double, curvature: Double) -> Int {
        let n = Int(ceil(sqrt(max(curvature, chord * 0.05) / (4 * tolerance))))
        return max(2, min(64, n))
    }

    static func parseAndFlatten(_ d: String) throws -> (rings: [[Pt]], lines: [Line]) {
        var tokens = tokenize(d)
        var i = 0
        func isCmd(_ t: String) -> Bool { t.unicodeScalars.count == 1 && CharacterSet.letters.contains(t.unicodeScalars.first!) }
        func num() throws -> Double {
            guard i < tokens.count, !isCmd(tokens[i]), let v = Double(tokens[i]) else { throw ParseError.expectedNumber }
            i += 1
            return v
        }
        func flag() throws -> Double {
            // Arc flags may be written without separators ("a1 1 0 011 1"): "011" splits.
            if i < tokens.count {
                let t = tokens[i]
                let sc = Array(t.unicodeScalars)
                if sc.count >= 2, (sc[0] == "0" || sc[0] == "1"), (sc[1] == "0" || sc[1] == "1") {
                    tokens[i] = String(String.UnicodeScalarView(sc[1...]))
                    return sc[0] == "1" ? 1 : 0
                }
            }
            return try num()
        }
        var rings: [[Pt]] = []
        var lines: [Line] = []
        var ring: [Pt] = []
        var cx = 0.0, cy = 0.0, sx = 0.0, sy = 0.0
        var lastCtrl: Pt? = nil
        var lastCmd = ""
        func push(_ x: Double, _ y: Double) { ring.append((x, y)); cx = x; cy = y }
        func close(_ closed: Bool = false) {
            if ring.count >= 2 { lines.append(Line(points: ring, closed: closed)) }
            if ring.count >= 3 { rings.append(ring) }
            ring = []
        }
        func cubic(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ x: Double, _ y: Double) {
            let dev = hypot(x1 - cx, y1 - cy) + hypot(x2 - x1, y2 - y1) + hypot(x - x2, y - y2) - hypot(x - cx, y - cy)
            let n = segmentsFor(chord: hypot(x - cx, y - cy), curvature: dev * 4)
            let x0 = cx, y0 = cy
            for k in 1...n {
                let t = Double(k) / Double(n), u = 1 - t
                push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
                     u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y)
            }
            lastCtrl = (x2, y2)
        }
        func quad(_ x1: Double, _ y1: Double, _ x: Double, _ y: Double) {
            let dev = hypot(x1 - cx, y1 - cy) + hypot(x - x1, y - y1) - hypot(x - cx, y - cy)
            let n = segmentsFor(chord: hypot(x - cx, y - cy), curvature: dev * 4)
            let x0 = cx, y0 = cy
            for k in 1...n {
                let t = Double(k) / Double(n), u = 1 - t
                push(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y)
            }
            lastCtrl = (x1, y1)
        }
        func arc(_ rxIn: Double, _ ryIn: Double, _ phiDeg: Double, _ large: Double, _ sweep: Double, _ x: Double, _ y: Double) {
            // SVG endpoint → centre parameterisation (SVG 1.1 F.6.5).
            let x0 = cx, y0 = cy
            if rxIn == 0 || ryIn == 0 || (x0 == x && y0 == y) { push(x, y); return }
            var rx = abs(rxIn), ry = abs(ryIn)
            let phi = phiDeg * .pi / 180, cp = cos(phi), sp = sin(phi)
            let dx = (x0 - x) / 2, dy = (y0 - y) / 2
            let x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy
            let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
            if lam > 1 { rx *= sqrt(lam); ry *= sqrt(lam) }
            let num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
            let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
            var co = sqrt(max(0, num2 / den))
            if large == sweep { co = -co }
            let cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx
            let ccx = cp * cxp - sp * cyp + (x0 + x) / 2, ccy = sp * cxp + cp * cyp + (y0 + y) / 2
            func ang(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double { atan2(ux * vy - uy * vx, ux * vx + uy * vy) }
            let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
            var dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
            if sweep == 0 && dt > 0 { dt -= 2 * .pi }
            if sweep != 0 && dt < 0 { dt += 2 * .pi }
            let r = max(rx, ry)
            let n = max(2, min(96, Int(ceil(abs(dt) / (2 * acos(max(0, 1 - tolerance / r)))))))
            for k in 1...n {
                let t = t1 + (dt * Double(k)) / Double(n)
                let ex = rx * cos(t), ey = ry * sin(t)
                push(cp * ex - sp * ey + ccx, sp * ex + cp * ey + ccy)
            }
        }
        while i < tokens.count {
            var cmd = tokens[i]
            if isCmd(cmd) { i += 1 }
            else if !lastCmd.isEmpty { cmd = lastCmd == "M" ? "L" : lastCmd == "m" ? "l" : lastCmd } // implicit repeat
            else { throw ParseError.mustStartWithM }
            let rel = cmd == cmd.lowercased() && cmd != "z"
            let ox = rel ? cx : 0, oy = rel ? cy : 0
            let C = cmd.uppercased()
            let prevCmd = lastCmd.uppercased()
            if C != "S" && C != "T" { lastCtrl = nil }
            switch C {
            case "M":
                close()
                let x = try num() + ox, y = try num() + oy
                push(x, y); sx = x; sy = y
            case "L": let x = try num() + ox; push(x, try num() + oy)
            case "H": push(try num() + ox, cy)
            case "V": push(cx, try num() + oy)
            case "C":
                let a = try num() + ox, b = try num() + oy, c = try num() + ox, e = try num() + oy
                let x = try num() + ox, y = try num() + oy
                cubic(a, b, c, e, x, y)
            case "S":
                let r: Pt = (lastCtrl != nil && (prevCmd == "C" || prevCmd == "S")) ? (2 * cx - lastCtrl!.0, 2 * cy - lastCtrl!.1) : (cx, cy)
                let c = try num() + ox, e = try num() + oy
                let x = try num() + ox, y = try num() + oy
                cubic(r.0, r.1, c, e, x, y)
            case "Q":
                let a = try num() + ox, b = try num() + oy
                let x = try num() + ox, y = try num() + oy
                quad(a, b, x, y)
            case "T":
                let r: Pt = (lastCtrl != nil && (prevCmd == "Q" || prevCmd == "T")) ? (2 * cx - lastCtrl!.0, 2 * cy - lastCtrl!.1) : (cx, cy)
                let x = try num() + ox, y = try num() + oy
                quad(r.0, r.1, x, y)
            case "A":
                let rx = try num(), ry = try num(), ph = try num(), la = try flag(), sw = try flag()
                let x = try num() + ox, y = try num() + oy
                arc(rx, ry, ph, la, sw, x, y)
            case "Z":
                cx = sx; cy = sy; close(true)
            default:
                throw ParseError.unsupported(cmd)
            }
            lastCmd = cmd
        }
        close()
        for k in rings.indices {
            let a = rings[k].first!, b = rings[k].last!
            if hypot(a.0 - b.0, a.1 - b.1) < 1e-9 { rings[k].removeLast() }
        }
        for k in lines.indices where lines[k].closed && lines[k].points.count > 2 {
            let a = lines[k].points.first!, b = lines[k].points.last!
            if hypot(a.0 - b.0, a.1 - b.1) < 1e-9 { lines[k].points.removeLast() }
        }
        return (rings, lines)
    }

    // MARK: - Simplify (Douglas–Peucker at the tolerance)

    static func simplifyLine(_ r: [Pt]) -> [Pt] {
        if r.count <= 2 { return r }
        var keep = [Bool](repeating: false, count: r.count)
        keep[0] = true; keep[r.count - 1] = true
        var stack: [(Int, Int)] = [(0, r.count - 1)]
        while let (a, b) = stack.popLast() {
            let A = r[a], B = r[b]
            let dx = B.0 - A.0, dy = B.1 - A.1, len = hypot(dx, dy)
            var best = -1, bd = 0.0
            if b > a + 1 {
                for k in (a + 1)..<b {
                    let P = r[k]
                    let d = len > 1e-12 ? abs(dx * (A.1 - P.1) - dy * (A.0 - P.0)) / len : hypot(P.0 - A.0, P.1 - A.1)
                    if d > bd { bd = d; best = k }
                }
            }
            if best >= 0 && bd > tolerance { keep[best] = true; stack.append((a, best)); stack.append((best, b)) }
        }
        return r.enumerated().filter { keep[$0.offset] }.map(\.element)
    }

    static func simplifyRing(_ r: [Pt]) -> [Pt] {
        if r.count <= 4 { return r }
        var far = 0, fd = -1.0
        for k in 1..<r.count {
            let d = pow(r[k].0 - r[0].0, 2) + pow(r[k].1 - r[0].1, 2)
            if d > fd { fd = d; far = k }
        }
        var keep = [Bool](repeating: false, count: r.count)
        keep[0] = true; keep[far] = true
        func at(_ k: Int) -> Pt { r[k % r.count] }
        var stack: [(Int, Int)] = [(0, far), (far, r.count)]
        while let (a, b) = stack.popLast() {
            let A = at(a), B = at(b)
            let dx = B.0 - A.0, dy = B.1 - A.1, len = hypot(dx, dy)
            var best = -1, bd = 0.0
            if b > a + 1 {
                for k in (a + 1)..<b {
                    let P = at(k)
                    let d = len > 1e-12 ? abs(dx * (A.1 - P.1) - dy * (A.0 - P.0)) / len : hypot(P.0 - A.0, P.1 - A.1)
                    if d > bd { bd = d; best = k }
                }
            }
            if best >= 0 && bd > tolerance { keep[best % r.count] = true; stack.append((a, best)); stack.append((best, b)) }
        }
        return r.enumerated().filter { keep[$0.offset] }.map(\.element)
    }

    // MARK: - Holes, overlaps, bridges

    static func signedArea(_ r: [Pt]) -> Double {
        var a = 0.0
        for k in r.indices { let p = r[k], q = r[(k + 1) % r.count]; a += p.0 * q.1 - q.0 * p.1 }
        return a / 2
    }

    static func inside(_ pt: Pt, _ r: [Pt]) -> Bool {
        var c = false
        var j = r.count - 1
        for k in r.indices {
            let a = r[k], b = r[j]
            if (a.1 > pt.1) != (b.1 > pt.1) && pt.0 < ((b.0 - a.0) * (pt.1 - a.1)) / (b.1 - a.1) + a.0 { c.toggle() }
            j = k
        }
        return c
    }

    struct Box { var x0, x1, y0, y1: Double }
    static func boxOf(_ r: [Pt]) -> Box {
        var b = Box(x0: .infinity, x1: -.infinity, y0: .infinity, y1: -.infinity)
        for (x, y) in r { b.x0 = min(b.x0, x); b.x1 = max(b.x1, x); b.y0 = min(b.y0, y); b.y1 = max(b.y1, y) }
        return b
    }

    static func containsRing(_ r: [Pt], _ rb: Box, _ sub: [Pt], _ sb: Box) -> Bool {
        if sb.x0 < rb.x0 || sb.x1 > rb.x1 || sb.y0 < rb.y0 || sb.y1 > rb.y1 { return false }
        for p in sub where !inside(p, r) { return false }
        return true
    }

    private static func sign(_ v: Double) -> Double { v > 0 ? 1 : v < 0 ? -1 : 0 }

    /// shapes.ts joinRings: containment decides holes (odd depth) and islands;
    /// partial overlaps merge; a hole crossing a solid cuts it (convex holes).
    static func joinRings(_ rings: [[Pt]]) -> [Pt] {
        if rings.isEmpty { return [] }
        let boxes = rings.map(boxOf)
        let areas = rings.map { abs(signedArea($0)) }
        // Largest first; ties keep their original order (JS sort is stable).
        let order = rings.indices.sorted { areas[$0] != areas[$1] ? areas[$0] > areas[$1] : $0 < $1 }
        var mult = [Int](repeating: 0, count: rings.count)
        var net = [Int](repeating: 0, count: rings.count)
        var done: [Int] = []
        for n in order {
            let containers = done.filter { areas[$0] > areas[n] && containsRing(rings[$0], boxes[$0], rings[n], boxes[n]) }
            let around = containers.reduce(0) { $0 + mult[$1] }
            var want = 1
            if let first = containers.first {
                let parent = containers.dropFirst().reduce(first) { areas[$1] < areas[$0] ? $1 : $0 }
                want = net[parent] != 0 ? 0 : 1
            }
            net[n] = want
            mult[n] = want - around
            done.append(n)
        }
        var traced: [[Pt]] = []
        func trace(_ r: [Pt], _ m: Int) {
            let o = sign(signedArea(r)) == sign(Double(m)) ? r : Array(r.reversed())
            for _ in 0..<abs(m) { traced.append(o) }
        }
        for n in rings.indices where mult[n] != 0 { trace(rings[n], mult[n]) }
        let holes = rings.indices.filter { net[$0] == 0 && mult[$0] != 0 && isConvex(rings[$0]) }
        for m in rings.indices where mult[m] > 0 {
            let bm = boxes[m]
            let crossing = holes.filter { n in
                let bn = boxes[n]
                if n == m || bm.x1 <= bn.x0 || bm.x0 >= bn.x1 || bm.y1 <= bn.y0 || bm.y0 >= bn.y1 { return false }
                return !containsRing(rings[m], bm, rings[n], bn) && !containsRing(rings[n], bn, rings[m], bm)
            }
            for n in crossing {
                if crossing.contains(where: { $0 != n && areas[$0] > areas[n] && containsRing(rings[$0], boxes[$0], rings[n], boxes[n]) }) { continue }
                let piece = clipToConvex(rings[m], rings[n])
                if piece.count >= 3 && abs(signedArea(piece)) > 1e-9 { trace(piece, -mult[m]) }
            }
        }
        return bridge(traced)
    }

    static func isConvex(_ r: [Pt]) -> Bool {
        var s = 0.0
        for k in r.indices {
            let a = r[k], b = r[(k + 1) % r.count], c = r[(k + 2) % r.count]
            let z = (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0)
            if abs(z) < 1e-12 { continue }
            if s == 0 { s = sign(z) } else if sign(z) != s { return false }
        }
        return true
    }

    /// Sutherland–Hodgman: `subject` clipped to the convex polygon `clip`.
    static func clipToConvex(_ subject: [Pt], _ clip: [Pt]) -> [Pt] {
        let o = sign(signedArea(clip)) == 0 ? 1 : sign(signedArea(clip))
        var out = subject
        var k = 0
        while k < clip.count && !out.isEmpty {
            let a = clip[k], b = clip[(k + 1) % clip.count]
            func side(_ p: Pt) -> Double { o * ((b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0)) }
            var next: [Pt] = []
            for i in out.indices {
                let p = out[i], q = out[(i + 1) % out.count]
                let pin = side(p) >= 0, qin = side(q) >= 0
                if pin { next.append(p) }
                if pin != qin {
                    let sp = side(p), sq = side(q), t = sp / (sp - sq)
                    next.append((p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t))
                }
            }
            out = next
            k += 1
        }
        return out
    }

    /// Join rings into one by zero-width bridges at the closest vertex pairs.
    static func bridge(_ rings: [[Pt]]) -> [Pt] {
        guard var ring = rings.first else { return [] }
        for n in 1..<max(1, rings.count) where n < rings.count {
            let sub = rings[n]
            var bi = 0, bj = 0, best = Double.infinity
            for a in ring.indices {
                for b in sub.indices {
                    let dd = pow(ring[a].0 - sub[b].0, 2) + pow(ring[a].1 - sub[b].1, 2)
                    if dd < best { best = dd; bi = a; bj = b }
                }
            }
            let rot = Array(sub[bj...] + sub[..<bj])
            ring = Array(ring[...bi]) + rot + [rot[0], ring[bi]] + Array(ring[(bi + 1)...])
        }
        return ring
    }
}

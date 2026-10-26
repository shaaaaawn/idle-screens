import Foundation

/// `timeline` — authored keyframes on a scene's own clock (schema 3.10).
///
/// A port of packages/schema/src/timeline.ts plus the steer.ts helpers it
/// leans on (`resolveSpecPath`, `canonicalSpecPath`, `applyDeltasToSpec`,
/// `lerpValue`, `easeSmooth`), over the raw spec JSON. Everything is a pure
/// function of (spec, t): resolving a scene at a time never depends on what
/// was drawn before, so a timeline scene seeks like any other.
///
/// Semantics (same as the web):
/// - Keys address the same dot-paths as live steering; a path must already
///   exist on the spec (a key cannot create a field).
/// - A key glides from wherever its path is at `t` to `value` over `dur` ms
///   (default 1000; 0 is a cut), eased `smooth` unless it says otherwise.
///   Overlapping glides start from the earlier one's in-flight value.
/// - Without `loop`, a path holds the base spec's value before its first key.
/// - With `loop`, time wraps every `duration` ms and a path's value before its
///   first key is its LAST key's value — one closed cycle per lap.
///
/// Read from JSON on purpose: `SpecSubset` is a lossy decode-only view, and a
/// key may address any field the format has (not just the ones native draws).
enum SpecTimeline {
    static let defaultKeyDur = 1000.0

    struct Key: Equatable, Sendable {
        let t: Double
        let path: String
        let value: JSONValue
        let ease: String?
        let dur: Double?
    }

    struct Timeline: Equatable, Sendable {
        let loop: Bool
        let duration: Double?
        let keys: [Key]
    }

    /// The spec's timeline, or nil when it has none (or one too broken to read).
    static func timeline(of spec: JSONValue) -> Timeline? {
        guard case .object(let root) = spec, case .object(let tl)? = root["timeline"] else { return nil }
        var keys: [Key] = []
        for raw in tl["keys"]?.array ?? [] {
            guard case .object(let k) = raw, let t = k["t"]?.number, t.isFinite,
                  let path = k["path"]?.string, let value = k["value"] else { continue }
            keys.append(Key(t: t, path: path, value: value, ease: k["ease"]?.string, dur: k["dur"]?.number))
        }
        let loop: Bool = { if case .bool(let b)? = tl["loop"] { return b } else { return false } }()
        return Timeline(loop: loop, duration: tl["duration"]?.number, keys: keys)
    }

    /// True when `spec` carries a timeline worth driving.
    static func hasTimeline(_ spec: JSONValue) -> Bool { !(timeline(of: spec)?.keys.isEmpty ?? true) }

    /// The spec without its `timeline`.
    static func withoutTimeline(_ spec: JSONValue) -> JSONValue {
        guard case .object(var root) = spec, root["timeline"] != nil else { return spec }
        root.removeValue(forKey: "timeline")
        return .object(root)
    }

    /// Keys grouped by the field they animate (index-form path), each group
    /// sorted by time (stable: equal times keep authored order, later wins).
    /// Keys whose path does not resolve are dropped, like the web runtime.
    static func tracks(of spec: JSONValue) -> [(path: String, keys: [Key])] {
        guard let tl = timeline(of: spec) else { return [] }
        let base = withoutTimeline(spec)
        var order: [String] = []
        var byPath: [String: [Key]] = [:]
        for k in tl.keys {
            guard let cp = canonicalPath(base, k.path) else { continue }
            if byPath[cp] == nil { order.append(cp) }
            byPath[cp, default: []].append(k)
        }
        return order.map { path in
            let sorted = byPath[path]!.enumerated()
                .sorted { $0.element.t != $1.element.t ? $0.element.t < $1.element.t : $0.offset < $1.offset }
                .map(\.element)
            return (path, sorted)
        }
    }

    /// Scene time folded into the timeline's own clock.
    static func localTime(_ tl: Timeline, _ t: Double) -> Double {
        let d = tl.duration ?? 0
        if tl.loop, d > 0 { return (t.truncatingRemainder(dividingBy: d) + d).truncatingRemainder(dividingBy: d) }
        return t
    }

    static func easeSmooth(_ k: Double) -> Double {
        let c = Swift.max(0, Swift.min(1, k))
        return c * c * (3 - 2 * c)
    }

    /// ω of the `spring` ease: settles to within 0.3 % of its target by the glide's end.
    private static let springOmega = 8.0
    private static let springEnd = 1 - (1 + springOmega) * exp(-springOmega)

    /// steer.ts `easeGlide`: a glide's progress curve by name, 0 → 1 and
    /// monotone. `in` / `out` are cubic; `spring` is the critically damped
    /// step response normalised to land on 1; anything unknown is `smooth`.
    static func easeGlide(_ ease: String?, _ k: Double) -> Double {
        let c = Swift.max(0, Swift.min(1, k))
        switch ease {
        case "step": return c >= 1 ? 1 : 0
        case "linear": return c
        case "in": return c * c * c
        case "out": let u = 1 - c; return 1 - u * u * u
        case "spring": return c >= 1 ? 1 : (1 - (1 + springOmega * c) * exp(-springOmega * c)) / springEnd
        default: return c * c * (3 - 2 * c)
        }
    }

    /// The eases a live steer honours (`STEER_EASES`): older names on stored
    /// tracks keep meaning smooth.
    static let steerEases: Set<String> = ["in", "out", "spring"]

    private static func ease(_ k: Key, _ x: Double) -> Double { easeGlide(k.ease, x) }

    /// One path's value at timeline-local time `tt`, starting from `start`.
    private static func evalTrack(_ keys: [Key], start: JSONValue?, tt: Double, leaf: String) -> JSONValue? {
        var from = start
        var key: Key?
        func at(_ tau: Double) -> JSONValue? {
            guard let key else { return from }
            let dur = key.dur ?? defaultKeyDur
            if dur <= 0 || tau >= key.t + dur { return key.value }
            return lerpValue(from, key.value, ease(key, (tau - key.t) / dur), rootKey: leaf)
        }
        for k in keys {
            if k.t > tt { break }
            from = at(k.t)
            key = k
        }
        return at(tt)
    }

    /// The scene at `t` ms with every key applied, and without its timeline,
    /// so it decodes and compiles like any plain spec. A spec without a
    /// timeline comes back unchanged.
    static func resolve(_ spec: JSONValue, at t: Double) -> JSONValue {
        guard let tl = timeline(of: spec) else { return spec }
        let base = withoutTimeline(spec)
        let tracks = tracks(of: spec)
        if tracks.isEmpty { return base }
        let tt = localTime(tl, t)
        var out = base
        for (path, keys) in tracks {
            let start = tl.loop ? keys[keys.count - 1].value : read(base, path)
            let leaf = path.split(separator: ".").last.map(String.init) ?? path
            if let v = evalTrack(keys, start: start, tt: tt, leaf: leaf) { write(&out, path, v) }
        }
        return out
    }

    /// Scene time (ms) of the next moment the picture changes after `t`: a
    /// key starting, or nil when nothing will ever move again. A glide in
    /// flight at `t` returns `t` itself (it is changing now).
    static func nextChange(_ spec: JSONValue, after t: Double) -> Double? {
        guard let tl = timeline(of: spec), !tl.keys.isEmpty else { return nil }
        let tt = localTime(tl, t)
        var soonest: Double?
        for k in tl.keys {
            let dur = k.dur ?? defaultKeyDur
            if tt >= k.t, tt < k.t + dur { return t }                  // gliding now
            if k.t > tt { soonest = Swift.min(soonest ?? .infinity, t + (k.t - tt)) }
        }
        if let soonest { return soonest }
        if tl.loop, let d = tl.duration, d > 0, let first = tl.keys.map(\.t).min() {
            return t + (d - tt) + first
        }
        return nil
    }

    // MARK: - Paths (steer.ts resolveSpecPath / canonicalSpecPath)

    private static let unsafeKeys: Set<String> = ["__proto__", "constructor", "prototype"]
    private static let steerableRootKeys: Set<String> = ["ghosting", "referenceViewport", "finish", "groups"]

    /// Index-form path parts, or nil when the path does not resolve.
    private static func resolvedParts(_ spec: JSONValue, _ path: String) -> [String]? {
        guard case .object(let root) = spec, !path.isEmpty else { return nil }
        var parts = path.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if parts.contains(where: unsafeKeys.contains) { return nil }
        if parts[0] != "layers", parts[0] != "background", case .array(let layers)? = root["layers"] {
            // A layer's own key wins over a root field of the same name.
            if let idx = layers.firstIndex(where: { if case .object(let l) = $0, case .string(let k)? = l["key"] { return k == parts[0] } else { return false } }) {
                parts.replaceSubrange(0...0, with: ["layers", String(idx)])
            } else if !steerableRootKeys.contains(parts[0]) {
                return nil
            }
        }
        // Group membership and a transform's origin only step: not targets.
        if parts[0] == "layers", parts.count == 3, parts[2] == "group" { return nil }
        if parts.count >= 2, parts[parts.count - 1] == "origin", parts[parts.count - 2] == "transform" { return nil }
        var node = spec
        for p in parts.dropLast() {
            switch node {
            case .object(let o): guard let n = o[p] else { return nil }; node = n
            case .array(let a): guard let i = Int(p), a.indices.contains(i) else { return nil }; node = a[i]
            default: return nil
            }
        }
        let last = parts[parts.count - 1]
        switch node {
        case .object(let o): return o[last] != nil ? parts : nil
        case .array(let a): return Int(last).map { a.indices.contains($0) } == true ? parts : nil
        default: return nil
        }
    }

    static func canonicalPath(_ spec: JSONValue, _ path: String) -> String? {
        resolvedParts(spec, path)?.joined(separator: ".")
    }

    static func read(_ spec: JSONValue, _ path: String) -> JSONValue? {
        guard let parts = resolvedParts(spec, path) else { return nil }
        var node = spec
        for p in parts {
            switch node {
            case .object(let o): node = o[p] ?? .null
            case .array(let a): node = a[Int(p)!]
            default: return nil
            }
        }
        return node
    }

    /// steer.ts `applyDeltasToSpec`: each delta's value written at its path,
    /// last wins; a path that does not resolve is skipped.
    static func applyDeltas(_ spec: JSONValue, _ deltas: [(path: String, value: JSONValue)]) -> JSONValue {
        var out = spec
        for d in deltas { write(&out, d.path, d.value) }
        return out
    }

    private static func write(_ spec: inout JSONValue, _ path: String, _ value: JSONValue) {
        guard let parts = resolvedParts(spec, path) else { return }
        spec = set(spec, parts[...], value)
    }

    private static func set(_ node: JSONValue, _ parts: ArraySlice<String>, _ value: JSONValue) -> JSONValue {
        guard let head = parts.first else { return value }
        let rest = parts.dropFirst()
        switch node {
        case .object(var o):
            o[head] = set(o[head] ?? .null, rest, value)
            return .object(o)
        case .array(var a):
            guard let i = Int(head), a.indices.contains(i) else { return node }
            a[i] = set(a[i], rest, value)
            return .array(a)
        default:
            return node
        }
    }

    // MARK: - lerpValue (steer.ts)

    private static let transformIdentity: [String: Double] = ["x": 0, "y": 0, "scale": 1, "scaleX": 1, "rotate": 0]

    /// Two `transform` objects with each one's missing identity fields filled,
    /// so a glide between them never steps.
    private static func alignTransform(_ a: JSONValue?, _ b: JSONValue?) -> (JSONValue?, JSONValue?) {
        guard case .object(var fa)? = a, case .object(var fb)? = b else { return (a, b) }
        for key in Set(fa.keys).union(fb.keys) {
            guard let id = transformIdentity[key] else { continue }
            if fa[key] == nil { fa[key] = .double(id) }
            if fb[key] == nil { fb[key] = .double(id) }
        }
        return (.object(fa), .object(fb))
    }

    private static func isHex(_ s: String) -> Bool {
        guard s.first == "#" else { return false }
        let body = s.dropFirst()
        return (body.count == 3 || body.count == 6) && body.allSatisfy(\.isHexDigit)
    }

    private static func hexToRGB(_ hex: String) -> [Int] {
        var h = String(hex.dropFirst())
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        let n = Int(h, radix: 16) ?? 0
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }

    private static func lerpHex(_ a: String, _ b: String, _ k: Double) -> String {
        let ca = hexToRGB(a), cb = hexToRGB(b)
        // JS Math.round: halves round up (toward +∞).
        let mix = (0..<3).map { i in Int((Double(ca[i]) + Double(cb[i] - ca[i]) * k + 0.5).rounded(.down)) }
        return "#" + mix.map { String(format: "%02x", $0) }.joined()
    }

    /// Numbers lerp, hex colours lerp per channel, equal-length arrays and
    /// objects recurse (over the TARGET's keys), anything else steps to the
    /// target at k > 0. `count` rounds (≥ 1); a field's `octaves`/`quantize` round.
    static func lerpValue(_ from: JSONValue?, _ to: JSONValue, _ k: Double, rootKey: String? = nil) -> JSONValue {
        var (a, b) = (from, Optional(to))
        if rootKey == "transform" { (a, b) = alignTransform(a, b) }
        let kk = Swift.max(0, Swift.min(1, k))
        return walk(a, b ?? to, kk, key: rootKey)
    }

    /// `lerpSpec`: two whole scenes at progress `k`. A layer `opacity`,
    /// `transform` or `group` (and a group's paint) present on one end only
    /// glides from its identity instead of stepping, and a root `timeline`
    /// steps — two timelines' key times never blend.
    static func lerpSpec(_ from: JSONValue, _ to: JSONValue, _ k: Double) -> JSONValue {
        let (a, b) = alignPaintFields(from, to)
        let kk = Swift.max(0, Swift.min(1, k))
        guard case .object(let oa) = a, case .object(let ob) = b else { return walk(a, b, kk, key: nil) }
        var out: [String: JSONValue] = [:]
        for (name, bv) in ob {
            // A field only the target has is JS `undefined` at k = 0: absent.
            if oa[name] == nil, kk <= 0 { continue }
            out[name] = name == "timeline" ? (kk > 0 ? bv : oa[name] ?? .null) : walk(oa[name], bv, kk, key: name)
        }
        return .object(out)
    }

    /// steer.ts `alignPaintFields`.
    private static func alignPaintFields(_ a: JSONValue, _ b: JSONValue) -> (JSONValue, JSONValue) {
        guard case .object(var ra) = a, case .object(var rb) = b else { return (a, b) }
        if case .array(var la)? = ra["layers"], case .array(var lb)? = rb["layers"] {
            for i in 0..<Swift.min(la.count, lb.count) {
                guard case .object(var x) = la[i], case .object(var y) = lb[i] else { continue }
                if (x["group"] == nil) != (y["group"] == nil) {
                    if x["group"] == nil { x["group"] = y["group"] } else { y["group"] = x["group"] }
                }
                if (x["opacity"] == nil) != (y["opacity"] == nil) {
                    if x["opacity"] == nil { x["opacity"] = .double(1) } else { y["opacity"] = .double(1) }
                }
                if x["transform"] != nil || y["transform"] != nil {
                    let (fx, fy) = alignTransform(x["transform"] ?? .object([:]), y["transform"] ?? .object([:]))
                    x["transform"] = fx; y["transform"] = fy
                }
                la[i] = .object(x); lb[i] = .object(y)
            }
            ra["layers"] = .array(la); rb["layers"] = .array(lb)
        }
        let ga: [String: JSONValue]? = { if case .object(let g)? = ra["groups"] { return g } else { return nil } }()
        let gb: [String: JSONValue]? = { if case .object(let g)? = rb["groups"] { return g } else { return nil } }()
        if ga != nil || gb != nil {
            var na = ga ?? [:], nb = gb ?? [:]
            for name in Set(na.keys).union(nb.keys) {
                var x: [String: JSONValue] = { if case .object(let o)? = na[name] { return o } else { return [:] } }()
                var y: [String: JSONValue] = { if case .object(let o)? = nb[name] { return o } else { return [:] } }()
                if (x["opacity"] == nil) != (y["opacity"] == nil) {
                    if x["opacity"] == nil { x["opacity"] = .double(1) } else { y["opacity"] = .double(1) }
                }
                if (x["transform"] == nil) != (y["transform"] == nil) {
                    if x["transform"] == nil { x["transform"] = .object([:]) } else { y["transform"] = .object([:]) }
                }
                na[name] = .object(x); nb[name] = .object(y)
            }
            ra["groups"] = .object(na); rb["groups"] = .object(nb)
        }
        return (.object(ra), .object(rb))
    }

    private static func walk(_ a: JSONValue?, _ b: JSONValue, _ kk: Double, key: String?) -> JSONValue {
        if let x = a?.number, let y = b.number, a?.isNumber == true, b.isNumber {
            let v = x + (y - x) * kk
            if key == "count" { return .int(Swift.max(1, Int(jsRound(v)))) }
            if key == "octaves" { return .int(Int(jsRound(v))) }
            if key == "quantize" { let q = Int(jsRound(v)); return .int(q < 2 ? 0 : q) }
            return .double(v)
        }
        if case .string(let sa)? = a, case .string(let sb) = b, isHex(sa), isHex(sb) {
            return .string(lerpHex(sa, sb, kk))
        }
        if key == "path", case .string(let sa)? = a, case .string(let sb) = b, sa != sb,
           let m = lerpPathD(sa, sb, kk) {
            return .string(m)
        }
        if case .array(let xa)? = a, case .array(let xb) = b, xa.count == xb.count {
            return .array(xb.indices.map { walk(xa[$0], xb[$0], kk, key: String($0)) })
        }
        if case .object(let oa)? = a, case .object(let ob) = b {
            var out: [String: JSONValue] = [:]
            for (name, bv) in ob {
                if oa[name] == nil, kk <= 0 { continue }
                if name == "transform" {
                    let (fa, fb) = alignTransform(oa[name], bv)
                    out[name] = walk(fa, fb ?? bv, kk, key: name)
                } else {
                    out[name] = walk(oa[name], bv, kk, key: name)
                }
            }
            return .object(out)
        }
        return kk > 0 ? b : (a ?? .null)
    }

    /// JavaScript's Math.round (halves toward +∞).
    private static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

    /// steer.ts `lerpPathD`: two SVG paths with the same commands and number
    /// count morph number by number (arc flags round); nil when they differ.
    static func lerpPathD(_ a: String, _ b: String, _ k: Double) -> String? {
        let ta = pathTokens(a), tb = pathTokens(b)
        guard ta.count == tb.count else { return nil }
        var out: [String] = []
        var cmd = "", argIndex = 0
        for (x, y) in zip(ta, tb) {
            let isCmdA = x.count == 1 && x.first!.isLetter, isCmdB = y.count == 1 && y.first!.isLetter
            if isCmdA != isCmdB { return nil }
            if isCmdA {
                if x != y { return nil }
                cmd = x.uppercased(); argIndex = 0
                out.append(x)
                continue
            }
            guard let va = Double(x), let vb = Double(y) else { return nil }
            let flag = cmd == "A" && (argIndex % 7 == 3 || argIndex % 7 == 4)
            argIndex += 1
            let v = va + (vb - va) * k
            out.append(flag ? jsNumber(jsRound(v)) : jsNumber((v * 100_000).rounded() / 100_000))
        }
        return out.joined(separator: " ")
    }

    /// `/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g`
    private static func pathTokens(_ d: String) -> [String] {
        let re = try! NSRegularExpression(pattern: #"[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"#)
        let ns = d as NSString
        return re.matches(in: d, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    /// A number as JS `String(n)` prints it for the values a path carries.
    private static func jsNumber(_ v: Double) -> String {
        if v == v.rounded(), abs(v) < 1e15 { return String(Int(v)) }
        return String(v)
    }
}

extension JSONValue {
    /// True for `.int` / `.double` (JS `typeof v === 'number'`).
    var isNumber: Bool {
        switch self {
        case .int, .double: return true
        default: return false
        }
    }
}

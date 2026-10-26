import Foundation

/// Native decode + timeline resolution for the `idle-sequence` envelope —
/// a multi-segment timeline over unmodified SaverSpecs (see
/// packages/schema/src/sequence.ts). Each segment's scene is an ordinary
/// SpecSubset the existing renderers already draw; this type only answers
/// "which segment, at what local time" — playback stays in TVAppState.
struct SequenceSubset: Decodable, Equatable, Sendable {
    /// The one segment to stand for the whole piece in a still: the one it
    /// spends longest in. The first is the wrong pick for timed pieces — an
    /// ident opens dark ("eclipse · sun") and rests on its card; a
    /// durationless tail holds forever, so it wins outright.
    var posterSegment: Segment? {
        segments.enumerated().max { a, b in
            let da = a.element.duration ?? .infinity, db = b.element.duration ?? .infinity
            return da == db ? a.offset < b.offset : da < db
        }?.element
    }

    /// The poster as one still: the poster segment drawn over the bed, on
    /// the bed's ground. Without a bed this is the poster segment's scene.
    var posterScene: SpecSubset? {
        guard var scene = posterSegment?.scene else { return bed }
        guard let bed else { return scene }
        scene.background = bed.background
        scene.layers = bed.layers + scene.layers
        return scene
    }

    var format: String?
    var id: String?
    var label: String?
    var seed: Int?
    var loop: Bool?
    /// `mount` (default): the clock starts at each screen's mount. `epoch`:
    /// it starts at the channel's shared clock, so every screen in a room
    /// shows the same segment (FORMAT.md **Sync**).
    var sync: String?
    /// Under `loop`, morph the wrap back into segment 0 (one morph chain only).
    var wrapMorph: Bool?
    var segments: [Segment]
    /// Each segment's scene as authored: what a morph lerps and what the
    /// structural check reads (`SpecSubset` keeps only what native draws).
    var rawScenes: [JSONValue] = []
    /// The ground under every segment, on the sequence's global clock — it
    /// never resets at a boundary. While a bed exists, segments paint
    /// transparently over it: their own `background` and `ghosting` are
    /// ignored (FORMAT.md **Bed**).
    var bed: SpecSubset?
    /// One print pass over the composed frame; wins over a segment's own.
    var finish: SpecSubset.Finish?

    /// The bed's seed: its own, else `seq.seed + 24` (past every segment's).
    func bedSeed(fallback: Int) -> Int {
        bed?.seed ?? ((seed ?? fallback) + 24)
    }

    private enum CodingKeys: String, CodingKey { case format, id, label, seed, loop, sync, wrapMorph, segments, bed, finish }

    init(format: String? = nil, id: String? = nil, label: String? = nil, seed: Int? = nil,
         loop: Bool? = nil, segments: [Segment], bed: SpecSubset? = nil) {
        self.format = format; self.id = id; self.label = label; self.seed = seed
        self.loop = loop; self.segments = segments; self.bed = bed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        format = try c.decodeIfPresent(String.self, forKey: .format)
        id = try? c.decodeIfPresent(String.self, forKey: .id)
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        seed = try? c.decodeIfPresent(Int.self, forKey: .seed)
        loop = try? c.decodeIfPresent(Bool.self, forKey: .loop)
        sync = try? c.decodeIfPresent(String.self, forKey: .sync)
        wrapMorph = try? c.decodeIfPresent(Bool.self, forKey: .wrapMorph)
        segments = try c.decode([Segment].self, forKey: .segments)
        let raw = (try? c.decode([JSONValue].self, forKey: .segments)) ?? []
        rawScenes = raw.map { seg in
            if case .object(let o) = seg, let scene = o["scene"] { return scene }
            return .null
        }
        // A bed the native decoder can't read is no bed — the segments still
        // play — rather than a sequence dropped to the thumbnail path.
        bed = (try? c.decodeIfPresent(SpecSubset.self, forKey: .bed)) ?? nil
        finish = (try? c.decodeIfPresent(SpecSubset.Finish.self, forKey: .finish)) ?? nil
    }

    struct Segment: Decodable, Equatable, Sendable {
        var key: String?
        var scene: SpecSubset
        /// Duration in ms. Only the final segment may omit this (holds).
        var duration: Double?
        var transition: Transition?
    }

    /// `cut` (default), `fade`, or `morph`, the last two with a duration.
    /// `fade` IS a crossfade; morph is rendered as one for now (a true
    /// spec-lerp is a follow-up). Treating only morph as timed made every
    /// `fade` in a live sequence land as a hard cut.
    struct Transition: Decodable, Equatable, Sendable {
        var type: String?
        var dur: Double?
        /// morph: `step` (default) | `crossfade` | `dip` — how differing words cross.
        var text: String?
        /// wipe: `circle` (default, an iris from `origin`) or `line` (a sweep at `angle`°).
        var shape: String?
        var origin: Point?
        var angle: Double?
        var feather: Double?

        struct Point: Decodable, Equatable, Sendable { var x: Double?; var y: Double? }

        var wipe: Wipe {
            Wipe(shape: shape ?? "circle", originX: origin?.x ?? 0.5, originY: origin?.y ?? 0.5,
                 angle: angle ?? 0, feather: feather ?? 0.08)
        }
    }

    /// A wipe's moving edge (compile.ts `wipeMask`).
    struct Wipe: Equatable, Sendable {
        var shape: String
        var originX: Double
        var originY: Double
        var angle: Double
        var feather: Double
    }

    /// True when a decoded scene document is a sequence envelope. Sequences
    /// carry no top-level `layers`, so without this check they'd be
    /// misrouted to the classic/thumb path.
    static func isSequenceDocument(format: String?) -> Bool {
        format == "idle-sequence"
    }

    // MARK: - Timeline resolution (port of resolveSegment)

    struct Resolved: Equatable {
        var index: Int
        /// Seconds into the segment.
        var localT: TimeInterval
        /// Cumulative start of this segment on the global timeline (seconds).
        var startT: TimeInterval
    }

    /// Map global time T (seconds) to (segment, localT). Segments are
    /// half-open [start, start+duration); a durationless final segment holds
    /// indefinitely. With loop, T wraps modulo the timed prefix.
    func resolve(at T: TimeInterval) -> Resolved {
        guard !segments.isEmpty else { return Resolved(index: 0, localT: 0, startT: 0) }

        var totalTimed: TimeInterval = 0
        for seg in segments {
            guard let d = seg.duration else { break }
            totalTimed += d / 1000
        }

        var t = max(0, T)
        if loop == true, totalTimed > 0 {
            t = t.truncatingRemainder(dividingBy: totalTimed)
        }

        var cumulative: TimeInterval = 0
        for (i, seg) in segments.enumerated() {
            guard let d = seg.duration else {
                return Resolved(index: i, localT: t - cumulative, startT: cumulative)
            }
            if t < cumulative + d / 1000 {
                return Resolved(index: i, localT: t - cumulative, startT: cumulative)
            }
            cumulative += d / 1000
        }

        let last = segments.count - 1
        let lastStart = cumulative - ((segments[last].duration ?? 0) / 1000)
        return Resolved(index: last, localT: t - lastStart, startT: lastStart)
    }

    /// Seconds until the NEXT segment boundary after global time T, or nil
    /// when the current segment holds forever (durationless tail, no loop).
    func nextBoundary(after T: TimeInterval) -> TimeInterval? {
        guard !segments.isEmpty else { return nil }
        let resolved = resolve(at: T)
        guard let d = segments[resolved.index].duration else { return nil }
        let remaining = d / 1000 - resolved.localT
        // Clamp against pathological zero/negative durations.
        return max(0.05, remaining)
    }

    // MARK: - Transitions (web parity: compile.ts SequenceInstance)

    /// How a boundary plays on screen.
    enum Crossing: Equatable {
        case cut
        /// Both segments live for `seconds`; the outgoing dissolves (fade) or
        /// is swept away by a moving edge (wipe).
        case fade(seconds: TimeInterval)
        case wipe(Wipe, seconds: TimeInterval)
        /// A lerp between structural twins over `seconds`, entity placement
        /// kept from the chain root (`from` is the outgoing segment).
        case morph(from: Int, seconds: TimeInterval, text: String)
    }

    /// The crossing INTO segment `index`. The web reads the boundary from
    /// `from` to `from + 1` off `segments[from].transition` — the OUTGOING
    /// segment's — and at a loop's wrap into 0, the last segment's: its
    /// `fade` (or `wipe`) always, its `morph` only under `wrapMorph` when the
    /// lap is one chain (`canWrapMorph`). A morph between segments that are
    /// not structural twins is a cut.
    func crossing(into index: Int, wrapped: Bool) -> Crossing {
        guard segments.indices.contains(index) else { return .cut }
        let from: Int
        if index > 0 { from = index - 1 } else if wrapped, segments.count > 1 { from = segments.count - 1 } else { return .cut }
        guard let tr = segments[from].transition, let dur = tr.dur, dur > 0 else { return .cut }
        switch tr.type {
        case "fade": return .fade(seconds: dur / 1000)
        case "wipe": return .wipe(tr.wipe, seconds: dur / 1000)
        case "morph":
            let ok = index > 0 ? canMorph(from: from) : canWrapMorph()
            return ok ? .morph(from: from, seconds: dur / 1000, text: tr.text ?? "step") : .cut
        default: return .cut
        }
    }

    /// Whether the boundary `from` → `from + 1` morphs: a `morph` transition
    /// between structural twins (sequence.ts `canMorph`).
    func canMorph(from: Int) -> Bool {
        guard segments.indices.contains(from), segments.indices.contains(from + 1),
              segments[from].transition?.type == "morph",
              rawScenes.indices.contains(from + 1) else { return false }
        return SequenceSubset.structuralSignature(rawScenes[from]) == SequenceSubset.structuralSignature(rawScenes[from + 1])
    }

    /// The first segment of the morph chain `index` belongs to.
    func morphChainRoot(_ index: Int) -> Int {
        var i = index
        while i > 0, canMorph(from: i - 1) { i -= 1 }
        return i
    }

    /// `canWrapMorph`: the wrap morphs only on a looping lap that is one chain
    /// whose last segment is a twin of the first.
    func canWrapMorph() -> Bool {
        guard wrapMorph == true, loop == true, segments.count > 1 else { return false }
        let last = segments.count - 1
        guard segments[last].transition?.type == "morph", segments[last].duration != nil,
              morphChainRoot(last) == 0, rawScenes.count == segments.count else { return false }
        return SequenceSubset.structuralSignature(rawScenes[last]) == SequenceSubset.structuralSignature(rawScenes[0])
    }

    /// The seed segment `index` renders with (sequence.ts `segmentRenderSeed`):
    /// its chain root's own seed, else the sequence seed plus the root's
    /// index; `fallback` (the host's seed) when neither exists.
    func renderSeed(_ index: Int, fallback: Int) -> Int {
        let root = morphChainRoot(index)
        guard segments.indices.contains(root) else { return fallback }
        if let own = segments[root].scene.seed { return own }
        if let seed { return seed + root }
        return fallback
    }

    /// True when global time T (seconds) has wrapped a looping lap.
    func hasWrapped(at T: TimeInterval) -> Bool {
        guard loop == true else { return false }
        var total: TimeInterval = 0
        for seg in segments {
            guard let d = seg.duration else { return false }
            total += d / 1000
        }
        return total > 0 && T >= total
    }

    /// `structuralSignature` (steer.ts) over the raw scene: the placement and
    /// motion fields baked into entities. Two twins compare equal; numbers
    /// compare by value, so `1` and `1.0` agree as they do in JSON.
    static func structuralSignature(_ scene: JSONValue) -> JSONValue {
        guard case .object(let root) = scene else { return .null }
        func canon(_ v: JSONValue?) -> JSONValue {
            switch v {
            case nil: return .null
            case .int(let i)?: return .double(Double(i))
            case .array(let a)?: return .array(a.map { canon($0) })
            case .object(let o)?: return .object(o.mapValues { canon($0) })
            case let other?: return other
            }
        }
        let layers: [JSONValue] = (root["layers"]?.array ?? []).map { raw in
            guard case .object(let l) = raw else { return .null }
            let sprite: [String: JSONValue] = { if case .object(let o)? = l["sprite"] { return o } else { return [:] } }()
            let kind = sprite["kind"]?.string
            var row: [JSONValue] = ["count", "size", "region", "position", "motion", "wrap", "flip", "alpha",
                                    "pulse", "spin", "grow", "layout", "emit", "clock"].map { canon(l[$0]) }
            row.append(canon(sprite["kind"]))
            row.append(canon(sprite["radius"]))
            row.append(canon(sprite["length"]))
            row.append(kind == "rect" ? .array([canon(sprite["width"]), canon(sprite["aspect"])])
                       : kind == "bar" ? .array([canon(sprite["length"]), canon(sprite["thickness"])]) : .null)
            row.append(sprite["colors"]?.array.map { .double(Double($0.count)) } ?? .null)
            row.append(canon(sprite["colorWeights"]))
            func cyclePeriod() -> JSONValue {
                if case .object(let c)? = sprite["cycle"] { return canon(c["period"]) } else { return .null }
            }
            switch kind {
            case "emoji": row.append(.array([.double(Double(sprite["glyphs"]?.array?.count ?? 0)), cyclePeriod()]))
            case "text": row.append(.array([.double(Double(sprite["strings"]?.array?.count ?? 0)), cyclePeriod()]))
            case "textBlock":
                if let anchor = sprite["anchor"], anchor != .null {
                    row.append(.array([canon(sprite["fontSize"]), canon(anchor)]))
                } else {
                    row.append(.array([canon(sprite["fontSize"])]))
                }
            default: row.append(.null)
            }
            if let rotate = l["rotate"] { row.append(canon(rotate)) }
            if let rock = l["rock"] { row.append(.object(["rock": canon(rock)])) }
            return .array(row)
        }
        return .array([canon(root["units"]), root["referenceViewport"].map { canon($0) } ?? .double(1080), .array(layers)])
    }
}

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
    var segments: [Segment]
    /// The ground under every segment, on the sequence's global clock — it
    /// never resets at a boundary. While a bed exists, segments paint
    /// transparently over it: their own `background` and `ghosting` are
    /// ignored (FORMAT.md **Bed**).
    var bed: SpecSubset?

    /// The bed's seed: its own, else `seq.seed + 24` (past every segment's).
    func bedSeed(fallback: Int) -> Int {
        bed?.seed ?? ((seed ?? fallback) + 24)
    }

    private enum CodingKeys: String, CodingKey { case format, id, label, seed, loop, segments, bed }

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
        segments = try c.decode([Segment].self, forKey: .segments)
        // A bed the native decoder can't read is no bed — the segments still
        // play — rather than a sequence dropped to the thumbnail path.
        bed = (try? c.decodeIfPresent(SpecSubset.self, forKey: .bed)) ?? nil
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

    /// The crossfade duration (seconds) entering `index`, per its transition.
    /// `cut` and absent transitions are instant.
    func transitionDuration(entering index: Int) -> TimeInterval {
        guard segments.indices.contains(index),
              let t = segments[index].transition,
              t.type == "morph" || t.type == "fade", let dur = t.dur else { return 0 }
        return dur / 1000
    }
}

import Foundation

/// Native decode + timeline resolution for the `idle-sequence` envelope —
/// a multi-segment timeline over unmodified SaverSpecs (see
/// packages/schema/src/sequence.ts). Each segment's scene is an ordinary
/// SpecSubset the existing renderers already draw; this type only answers
/// "which segment, at what local time" — playback stays in TVAppState.
struct SequenceSubset: Decodable, Equatable, Sendable {
    var format: String?
    var id: String?
    var label: String?
    var seed: Int?
    var loop: Bool?
    var segments: [Segment]

    struct Segment: Decodable, Equatable, Sendable {
        var key: String?
        var scene: SpecSubset
        /// Duration in ms. Only the final segment may omit this (holds).
        var duration: Double?
        var transition: Transition?
    }

    /// `cut` (default) or `morph` with a duration — v1 renders morph as a
    /// timed crossfade; true spec-lerp morph is a follow-up.
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
              t.type == "morph", let dur = t.dur else { return 0 }
        return dur / 1000
    }
}

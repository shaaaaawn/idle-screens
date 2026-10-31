import Foundation

/// Can the phone's native renderer draw this spec as it looks on air?
///
/// The native renderer re-implements the SaverSpec format and deliberately
/// skips some of it (FORMAT.md marks each "Native: ignored"). Most of those
/// gaps are graceful — a print `finish` it leaves off is the same picture
/// without grain. These are not: they are how a scene *moves or reads*, and
/// dropping them turns a timed piece into a dark first frame. Seen on
/// 2026-10-01: logo's "deep-seek" sequence (a whale over a sunburst with
/// words cycling) drew natively as a near-black still.
///
/// Read from the RAW spec on purpose: `SpecSubset` drops unknown fields and
/// collapses a sequence to its first segment, so by then the evidence is gone.
enum NativeSupport {
    enum Gap: String, Equatable, CaseIterable {
        /// An `idle-sequence` envelope: native draws only the first segment.
        case sequence
        /// Keyframes on the scene's clock: a recorded scene is compiled once,
        /// so native shows the base spec.
        case timeline
        /// A sequence's under-layer: native ignores it.
        case bed
    }

    // Paint groups, a layer's paint-level `transform`, `group` membership and
    // `opacity` used to be gaps here too. The shared renderer has drawn them
    // since the tvOS spec-parity work (#319, 2026-10-17; FORMAT.md marks them
    // "Native: rendered"), so a scene that uses them stays native.

    /// Every gap in `spec`, in a stable order. Empty = native is faithful.
    static func gaps(in spec: JSONValue?) -> [Gap] {
        guard case .object(let root)? = spec else { return [] }
        var found = Set<Gap>()
        if root["segments"] != nil || root["format"].flatMap(\.string) == "idle-sequence" {
            found.insert(.sequence)
        }
        if root["timeline"] != nil { found.insert(.timeline) }
        if root["bed"] != nil { found.insert(.bed) }
        return Gap.allCases.filter(found.contains)
    }

    static func isFaithful(_ spec: JSONValue?) -> Bool { gaps(in: spec).isEmpty }
}

extension JSONValue {
    var string: String? { if case .string(let s) = self { return s } else { return nil } }
    var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    var number: Double? {
        switch self {
        case .int(let i): return Double(i)
        case .double(let d): return d
        default: return nil
        }
    }
}

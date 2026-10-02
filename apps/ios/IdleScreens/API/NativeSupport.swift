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
        /// Keyframes on the scene's clock: native shows the base spec.
        case timeline
        /// Multi-layer subjects moved/faded as one: native paints identity.
        case groups
        /// A sequence's under-layer: native ignores it.
        case bed
        /// A layer's paint-level transform: native draws it untransformed.
        case layerTransform
        /// A layer joined to a group.
        case layerGroup
        /// A layer at opacity other than 1 (0 hides it on the site, not here).
        case layerOpacity
    }

    /// Every gap in `spec`, in a stable order. Empty = native is faithful.
    static func gaps(in spec: JSONValue?) -> [Gap] {
        guard case .object(let root)? = spec else { return [] }
        var found = Set<Gap>()
        if root["segments"] != nil || root["format"].flatMap(\.string) == "idle-sequence" {
            found.insert(.sequence)
        }
        if root["timeline"] != nil { found.insert(.timeline) }
        if root["groups"] != nil { found.insert(.groups) }
        if root["bed"] != nil { found.insert(.bed) }
        for layer in root["layers"].flatMap(\.array) ?? [] {
            guard case .object(let l) = layer else { continue }
            if l["transform"] != nil { found.insert(.layerTransform) }
            if l["group"] != nil { found.insert(.layerGroup) }
            if let opacity = l["opacity"].flatMap(\.number), opacity != 1 { found.insert(.layerOpacity) }
        }
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

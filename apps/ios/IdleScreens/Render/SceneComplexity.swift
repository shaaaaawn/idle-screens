import Foundation

/// Static complexity heuristics + the learned per-channel tier caps.
/// Two protection layers with different jobs:
///  - `precap` guesses BEFORE first render that a schema is too heavy for the
///    current tier (no first-visit jank while the watchdog warms up).
///  - `TierCapStore` REMEMBERS watchdog verdicts per channel, so a scene that
///    proved too heavy on this hardware starts lower forever after.
enum SceneComplexity {

    /// Entity/effect ceilings for the full-fidelity Canvas tier. Above these,
    /// the GPU sprite tier renders the same scene comfortably; the Canvas
    /// tier would grind. Numbers derive from the t2 load-shed budget (150
    /// drawn entities) and the cost of per-frame radial gradients.
    static let maxEntitiesForCanvas = 900
    static let maxSoftCirclesForCanvas = 220

    /// Suggested cap for a compiled scene, or nil when no cap is needed.
    /// Only ever suggests t2 — the GPU tier renders arbitrary entity counts;
    /// tiers below it are quality floors, not performance escapes.
    static func precap(for layers: [CompiledLayer]) -> CapabilityTier? {
        var entities = 0
        var soft = 0
        for layer in layers {
            entities += layer.entities.count
            if case .circle(_, _, _, true) = layer.sprite {
                soft += layer.entities.count
            }
        }
        if entities > maxEntitiesForCanvas || soft > maxSoftCirclesForCanvas {
            return .t2
        }
        return nil
    }
}

/// Persisted per-channel tier caps, learned from watchdog downgrades.
/// "This scene was too heavy for this box at tier X" is durable knowledge —
/// re-learning it every session means janky first minutes every session.
struct TierCapStore {
    static let key = "tv.channel_tier_caps"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func cap(for channelId: String) -> CapabilityTier? {
        let dict = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        return dict[channelId].flatMap(CapabilityTier.init(rawValue:))
    }

    func record(_ tier: CapabilityTier, for channelId: String) {
        var dict = defaults.dictionary(forKey: Self.key) as? [String: String] ?? [:]
        // Only ever tighten: a cap loosens again solely via clear() (e.g. the
        // spec changed upstream, or the user resets in Settings).
        if let existing = dict[channelId].flatMap(CapabilityTier.init(rawValue:)),
           existing.isLowerOrEqual(to: tier) {
            return
        }
        dict[channelId] = tier.rawValue
        defaults.set(dict, forKey: Self.key)
    }

    func clearAll() {
        defaults.removeObject(forKey: Self.key)
    }
}

extension CapabilityTier {
    /// t3 is highest. Rank for comparisons.
    var rank: Int {
        switch self {
        case .t3: return 3
        case .t2: return 2
        case .t1: return 1
        case .t0: return 0
        }
    }

    func isLowerOrEqual(to other: CapabilityTier) -> Bool { rank <= other.rank }

    static func lower(of a: CapabilityTier, _ b: CapabilityTier) -> CapabilityTier {
        a.rank <= b.rank ? a : b
    }
}

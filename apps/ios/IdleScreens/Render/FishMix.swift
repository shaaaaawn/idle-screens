import Foundation

/// The metaquarium `fishMix` DSL, read the way the engine reads it.
///
/// A Swift port of `parseFishMix` (packages/saver-metaquarium/src/ipfs.ts)
/// against the default catalog — the only catalog a published scene can
/// name. Grammar per comma-separated token: `id[:count][@style][*size]`,
/// where `id` is a minted token id (1–512), an unminted breed id (601–613),
/// or a breed name. `*size` comes off the very end, then `@style`.
///
/// Minted fish are individuals: no token id appears twice in a scene, so
/// `300:12` is twelve DISTINCT angelfish (300 and its nearest unused
/// neighbours in the breed's range) and `angelfish:3` three spread across
/// the range. Unminted breeds are species and keep plain counts.
///
/// Before this port the TV split tokens on `:` alone, so `seahorse:3@hover`
/// lost its count and `457@drift` lost its fish — most live tanks drew the
/// wrong cast. Parity matters beyond the TV: `lofi.ts` (the browser mirror
/// of the TV tank) already reads mixes with the engine's own parser.
enum FishMix {
    struct Entry: Equatable, Sendable {
        let id: Int
        let breed: String
        /// Minted entries are expanded to one per fish (count 1); an
        /// unminted species keeps its count on a single entry.
        var count: Int = 1
        var style: String?
        var size: Double?
    }

    static let totalSupply = 512

    /// Minted breeds by token-id range (farm.ts `BREEDS`).
    static let mintedRanges: [(breed: String, lo: Int, hi: Int)] = [
        ("betafish", 1, 256), ("angelfish", 257, 456), ("seahorse", 457, 496), ("seaturtle", 497, 512),
    ]

    /// The unminted breeds the package bundles (ipfs.ts `NPC_CATALOG`). 607
    /// (jellyfish) was retired; its id stays unused.
    static let unminted: [(id: Int, breed: String)] = [
        (601, "blowfish"), (602, "hackerfish"), (603, "glowfish"), (604, "babyfish"),
        (605, "shark"), (606, "crab"), (608, "dori"), (609, "starfish"),
        (610, "octopus"), (611, "snail"), (612, "dot"), (613, "dolphin"),
    ]

    /// Swim styles the engine knows (swim.ts `SWIM_STYLES`).
    static let swimStyles: Set<String> = [
        "loop", "school", "drift", "hover", "patrol", "bottom", "surface", "follow", "pair", "chase",
    ]

    static func breed(ofMinted id: Int) -> String? {
        mintedRanges.first { id >= $0.lo && id <= $0.hi }?.breed
    }

    /// A key resolved against the default catalog: minted id, unminted id,
    /// or a breed name (minted aliases spread across their range).
    private enum Resolved {
        case minted(id: Int, breed: String, alias: Bool)
        case unminted(id: Int, breed: String)
    }

    private static func resolve(_ rawKey: Substring) -> Resolved? {
        let key = rawKey.trimmingCharacters(in: .whitespaces).lowercased()
        if !key.isEmpty, key.allSatisfy(\.isASCIIDigit), let n = Int(key) {
            if let b = breed(ofMinted: n) { return .minted(id: n, breed: b, alias: false) }
            if let npc = unminted.first(where: { $0.id == n }) { return .unminted(id: npc.id, breed: npc.breed) }
            return nil
        }
        if let range = mintedRanges.first(where: { $0.breed == key }) {
            return .minted(id: range.lo, breed: range.breed, alias: true)
        }
        if let npc = unminted.first(where: { $0.breed == key }) { return .unminted(id: npc.id, breed: npc.breed) }
        return nil
    }

    /// Whether `core` (no `@`/`*`) is a complete valid `id[:count]` token.
    private static func resolvesAsToken(_ core: Substring) -> Bool {
        let parts = core.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return false }
        if parts.count == 2 {
            guard let c = Int(parts[1].trimmingCharacters(in: .whitespaces)), c >= 1 else { return false }
        }
        return resolve(parts[0]) != nil
    }

    /// Every entry the mix casts, in slot order. Never throws: a bad token is
    /// skipped and the rest still parse, like the engine.
    static func parse(_ mix: String) -> [Entry] {
        var entries: [Entry] = []
        var used = Set<Int>()

        func allocate(_ breed: String, want: Int) -> Int? {
            guard let r = mintedRanges.first(where: { $0.breed == breed }) else { return nil }
            if !used.contains(want), want >= r.lo, want <= r.hi { used.insert(want); return want }
            guard r.hi > r.lo else { return nil }
            for d in 1...(r.hi - r.lo) {
                for cand in [want + d, want - d] where cand >= r.lo && cand <= r.hi && !used.contains(cand) {
                    used.insert(cand)
                    return cand
                }
            }
            return nil
        }

        for raw in mix.split(separator: ",") {
            var token = Substring(raw.trimmingCharacters(in: .whitespaces))
            if token.isEmpty { continue }
            var size: Double?
            if let star = token.lastIndex(of: "*") {
                if let n = Double(token[token.index(after: star)...].trimmingCharacters(in: .whitespaces)),
                   n.isFinite, n > 0 {
                    size = min(4, max(0.25, n))
                }
                token = Substring(token[..<star].trimmingCharacters(in: .whitespaces))
            }
            var style: String?
            var core = token
            if let at = token.lastIndex(of: "@") {
                let styleRaw = token[token.index(after: at)...].trimmingCharacters(in: .whitespaces).lowercased()
                let styledCore = Substring(token[..<at].trimmingCharacters(in: .whitespaces))
                if resolvesAsToken(token) {
                    // A complete token that merely ends in a style word stays whole.
                } else if swimStyles.contains(styleRaw) {
                    core = styledCore
                    style = styleRaw
                } else if resolvesAsToken(styledCore) {
                    core = styledCore      // unknown style: the fish still swims
                }
            }
            let parts = core.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count <= 2, let fish = resolve(parts[0]) else { continue }
            var count = 1
            if parts.count == 2 {
                guard let n = Int(parts[1].trimmingCharacters(in: .whitespaces)), n >= 1 else { continue }
                count = min(24, n)
            }
            switch fish {
            case .unminted(let id, let breed):
                entries.append(Entry(id: id, breed: breed, count: count, style: style, size: size))
            case .minted(let id, let breed, let alias):
                guard let r = mintedRanges.first(where: { $0.breed == breed }) else { continue }
                for i in 0..<count {
                    let want = alias ? r.lo + ((r.hi - r.lo) * i) / max(1, count) : id
                    guard let got = allocate(breed, want: want) else { break }
                    entries.append(Entry(id: got, breed: breed, style: style, size: size))
                }
            }
        }
        return entries
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}

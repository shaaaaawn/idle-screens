import Foundation

/// `text: 'crossfade' | 'dip'` on a sequence morph (compile.ts
/// `crossfadeOverrides`): every text / textBlock layer whose words differ
/// between the two ends is painted twice for the window — the outgoing words
/// at `1 − k` under the incoming at `k` (crossfade), or one after the other
/// (dip: out over the first half, in over the second) — both in the lerped
/// frame's paint, so colour and alpha glide as usual.
enum MorphText {
    /// The words a text layer paints (`strings`, or a textBlock's `text`).
    static func strings(of sprite: JSONValue?) -> [String]? {
        guard case .object(let s)? = sprite else { return nil }
        switch s["kind"]?.string {
        case "text": return s["strings"]?.array?.compactMap(\.string)
        case "textBlock": return s["text"]?.string.map { [$0] }
        default: return nil
        }
    }

    private static func layerSprite(_ spec: JSONValue, _ i: Int) -> JSONValue? {
        guard case .object(let root) = spec, let layers = root["layers"]?.array,
              layers.indices.contains(i), case .object(let l) = layers[i] else { return nil }
        return l["sprite"]
    }

    /// (aOut, aIn) at eased progress `k`.
    static func alphas(k: Double, dip: Bool) -> (Double, Double) {
        dip ? (max(0, 1 - 2 * k), max(0, 2 * k - 1)) : (1 - k, k)
    }

    static func applyCrossfade(_ layers: inout [CompiledLayer], from a: JSONValue, to b: JSONValue,
                               lerped: JSONValue, k: Double, dip: Bool) {
        let (aOut, aIn) = alphas(k: k, dip: dip)
        for i in layers.indices {
            guard let wa = strings(of: layerSprite(a, i)), let wb = strings(of: layerSprite(b, i)), wa != wb, !wa.isEmpty,
                  case .object(var now)? = layerSprite(lerped, i) else { continue }
            if now["kind"]?.string == "text" {
                now["strings"] = .array(wa.map { .string($0) })
            } else {
                now["text"] = .string(wa[0])
            }
            guard let data = try? JSONEncoder().encode(JSONValue.object(now)),
                  let outgoing = try? JSONDecoder().decode(SpecSubset.Sprite.self, from: data) else { continue }
            let outGlyphs: [String]? = now["kind"]?.string == "text"
                ? layers[i].entities.map { wa[min(max(0, $0.glyphIndex), wa.count - 1)] } : nil
            layers[i].textCrossfade = TextCrossfade(outgoing: outgoing, outGlyphs: outGlyphs, aOut: aOut, aIn: aIn)
        }
    }
}

import SwiftUI

/// The "never show an error" surface: when a channel can't be rendered
/// faithfully on this device (classic saver with no thumb stream, repeated
/// stream failures), synthesize a seeded ambient scene in the brand language
/// and render it with the GPU sprite tier — which every supported Apple TV
/// can drive. Deterministic per channel, always in motion, honest caption.
struct FallbackSceneView: View {
    let channelId: String
    var caption: String = "live view isn't available on this TV"

    @State private var layers: [CompiledLayer] = []
    @State private var background: SpecSubset.Background?

    var body: some View {
        ZStack {
            if layers.isEmpty {
                Color.black.ignoresSafeArea()
            } else {
                SpriteSceneView(layers: layers, background: background)
                    .ignoresSafeArea()
            }

            VStack {
                Spacer()
                Text(caption)
                    .font(.system(size: 25))
                    .foregroundStyle(.white.opacity(0.45))
                    .padding(.bottom, 56)
            }
        }
        .task {
            let spec = Self.ambientSpec(seed: channelId)
            layers = spec.compile(seed: spec.seed ?? 1)
            background = spec.background
        }
    }

    /// A small ambient spec in the app's visual language — drifting glow
    /// orbs, rising embers, static stars — seeded by the channel id so every
    /// channel's stand-in is its own scene.
    static func ambientSpec(seed: String) -> SpecSubset {
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        let json = """
        {"seed": \(hash % 100_000),
         "units": "viewport",
         "background": {"type": "gradient", "stops": [
            {"at": 0, "color": "#0A0A0F"}, {"at": 0.7, "color": "#101426"},
            {"at": 1, "color": "#181233"}]},
         "layers": [
            {"count": 70, "sprite": {"kind": "circle", "radius": [0.0008, 0.0018], "color": "#aab2d0"},
             "alpha": [0.25, 0.7], "motion": {"type": "static"}},
            {"count": 6, "sprite": {"kind": "circle", "radius": [0.06, 0.11], "color": "#8B7CFF", "soft": true},
             "alpha": [0.08, 0.16], "blend": "lighter", "motion": {"type": "wander", "speed": [0.002, 0.006], "coherence": 0.2}},
            {"count": 4, "sprite": {"kind": "circle", "radius": [0.05, 0.09], "color": "#5EEAD4", "soft": true},
             "alpha": [0.06, 0.12], "blend": "lighter", "motion": {"type": "wander", "speed": [0.002, 0.005], "coherence": 0.2}},
            {"count": 10, "sprite": {"kind": "circle", "radius": [0.002, 0.005], "color": "#FFD60A"},
             "alpha": [0.3, 0.7], "blend": "lighter", "motion": {"type": "rise", "speed": [0.004, 0.012], "sway": 0.004}}
         ]}
        """
        // The template is compile-time constant; decode cannot fail.
        return (try? JSONDecoder().decode(SpecSubset.self, from: Data(json.utf8)))
            ?? SpecSubset(id: nil, label: nil, seed: Int(hash % 100_000),
                          units: .viewport, background: nil, layers: [])
    }
}

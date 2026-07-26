import SwiftUI

/// Live, animated native preview of a channel's scene spec — used for
/// gallery tiles and poster cards. Compiles the spec once per appearance
/// and renders at the 30fps tier; no watchdog (previews never downgrade,
/// they're small and clipped).
struct ScenePreviewView: View {
    let spec: SpecSubset
    /// Stable fallback seed when the spec doesn't carry one (per-channel,
    /// so two channels with the same spec still differ).
    var fallbackSeed: String = ""

    @State private var layers: [CompiledLayer]?

    var body: some View {
        ZStack {
            if let layers {
                NativeSceneView(
                    layers: layers,
                    background: spec.background,
                    tier: .t2
                )
            } else {
                // One frame of background color while the compile task runs.
                Color(hex: spec.background?.primaryColor ?? "0A0A0F")
            }
        }
        .task(id: spec) {
            layers = spec.compile(seed: spec.seed ?? Self.stableSeed(fallbackSeed))
        }
    }

    /// FNV-1a over the id — deterministic across launches (hashValue isn't).
    private static func stableSeed(_ s: String) -> Int {
        var hash: UInt32 = 2_166_136_261
        for byte in s.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Int(hash)
    }
}

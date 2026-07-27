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
        // Render on a virtual 1080p canvas and scale down, so the preview is
        // an exact miniature of the fullscreen render. Rendering at tile size
        // distorts px-unit specs badly: positions compress into the tile
        // while pixel-sized sprites stay full size — cramped and "stretched".
        GeometryReader { geo in
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
            .frame(width: 1920, height: 1080)
            .scaleEffect(x: geo.size.width / 1920,
                         y: geo.size.height / 1080,
                         anchor: .topLeading)
        }
        .clipped()
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

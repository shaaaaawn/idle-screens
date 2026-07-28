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
    /// Live animation vs a static first frame. A grid of tiles MUST use
    /// static: ~10 concurrent live Canvas layers exhausts the render-layer
    /// budget and the system silently drops one — a black tile. Keep live
    /// surfaces to one or two per screen (hero, backdrop).
    var live: Bool = true

    @State private var layers: [CompiledLayer]?

    /// Which animation slot this tile holds, if any. Tiles without one still
    /// draw — a single static frame — so the gallery looks the same at rest.
    @State private var slot: Int?

    /// Re-checked every render: a slot can be revoked (fullscreen viewing,
    /// memory pressure) while the tile is still on screen.
    private var animates: Bool {
        guard live, let slot else { return false }
        return PreviewBudget.shared.permits(slot: slot)
    }

    var body: some View {
        ZStack {
            if let layers {
                if SceneVisibility.verdict(layers: layers, background: spec.background) == .invisible {
                    // This scene would render as a black/blank tile —
                    // deterministic generative art beats broken-looking.
                    ProceduralChannelArt(channelId: fallbackSeed)
                } else {
                    // referenceSize keeps 1920x1080 composition semantics while
                    // the view itself stays tile-sized. Laying the view out at
                    // 1920x1080pt cost a backing store of that size per tile
                    // (~75 MB at 3x) and jetsam-killed the gallery mid-scroll.
                    NativeSceneView(
                        layers: layers,
                        background: spec.background,
                        tier: .t2,
                        referenceSize: CGSize(width: 1920, height: 1080),
                        // Two independent gates, both required to animate:
                        // `live` is the caller's intent (grids pass false), and
                        // the budget is the device's answer under real pressure.
                        staticFrame: !animates
                    )
                }
            } else {
                // One frame of background color while the compile task runs.
                Color(hex: spec.background?.primaryColor ?? "0A0A0F")
            }
        }
        .clipped()
        .task(id: spec) {
            layers = spec.compile(seed: spec.seed ?? Self.stableSeed(fallbackSeed),
                                  budget: SpecSubset.Budget.preview)
        }
        #if DEBUG
        // Proves the @Observable read in `animates` actually re-invokes body
        // when the budget moves — a revocation that silently never fires would
        // look exactly like a working one.
        .onChange(of: animates) { _, now in
            print("[budget] tile slot \(slot.map(String.init) ?? "-") animates=\(now)")
        }
        #endif
        .onAppear {
            // Only contend for a slot if the caller even wants animation.
            if live, slot == nil { slot = PreviewBudget.shared.claimSlot() }
        }
        .onDisappear {
            if let slot {
                PreviewBudget.shared.releaseSlot(slot)
                self.slot = nil
            }
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

import SwiftUI

/// A past scene, drawn natively from its recorded spec.
///
/// The live page is drawn by the web engine, but the site's bare page cannot be
/// told "show scene 182" — its scrubber is internal state with no host hook. So
/// history is drawn here, from the spec the server kept. It is a faithful
/// re-render rather than a screenshot: the format is deterministic, so spec +
/// seed is the moment itself.
struct RecordedSceneView: View {
    let scene: RecordedScene
    let channelId: String
    @State private var layers: [CompiledLayer]?

    var body: some View {
        ZStack {
            if let spec = scene.spec {
                Color(hex: spec.background?.primaryColor ?? "0A0A0F")
                if let layers {
                    NativeSceneView(layers: layers, background: spec.background, tier: .t3)
                        .transition(.opacity)
                }
            } else if let kind = ClassicSaverKind.supported(id: scene.classicSaverId) {
                ClassicSaverView(kind: kind, seed: scene.seed ?? ClassicSaverKind.seed(forChannel: channelId))
            } else {
                // A classic saver with no native port. Say so rather than
                // show a black page that looks like a failure.
                ProceduralChannelArt(channelId: channelId)
                VStack(spacing: 6) {
                    Text(scene.label ?? "a past scene")
                        .font(.headline)
                        .foregroundStyle(Color.textPrimary)
                    Text("This one only plays live.")
                        .font(.footnote)
                        .foregroundStyle(Color.textSecondary)
                }
                .padding(22)
                .glassPanel(shape: RoundedRectangle(cornerRadius: 20))
            }
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.4), value: layers != nil)
        .task(id: scene.id) {
            guard let spec = scene.spec else { return }
            layers = spec.compile(seed: scene.seed ?? spec.seed ?? 0,
                                  budget: SpecSubset.Budget.fullscreen)
        }
    }
}

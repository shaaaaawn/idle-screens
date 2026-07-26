import SwiftUI

/// Full-screen, chrome-free host for the active channel. Picks the renderer
/// from the effective capability tier; dims to black while the channel sleeps.
struct ScreenSaverView: View {
    @Environment(TVAppState.self) private var app

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if app.sleeping {
                Color.black.ignoresSafeArea()
            } else if app.isClassicSpec {
                // Classic savers (e.g. {"id":"warp"}) can't render natively and
                // previewScene doesn't support them — the thumb stream is the
                // only live view; on repeated thumb failure show a fallback note.
                if app.thumbFailed {
                    ClassicFallbackView(channelId: app.selectedChannelId ?? "")
                } else {
                    ThumbStreamView(channelId: app.selectedChannelId ?? "")
                }
            } else if app.compiledScene.isEmpty {
                ProgressView()
                    .scaleEffect(2)
            } else {
                switch app.effectiveTier {
                case .t3, .t2:
                    NativeSceneView(
                        layers: app.compiledScene,
                        background: app.specBackground,
                        tier: app.effectiveTier,
                        watchdog: app.watchdog,
                        onDowngrade: { app.watchdogDidTrigger() }
                    )
                case .t1:
                    ThumbStreamView(channelId: app.selectedChannelId ?? "")
                case .t0:
                    PerceptionView(
                        specJSON: app.currentSpecJSON,
                        backgroundColor: app.specBackground?.primaryColor
                    )
                }
            }

            if let overlay = app.overlayText {
                Text(overlay)
                    .font(.system(size: 72, weight: .semibold))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.8), radius: 16)
                    .padding(48)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: app.overlayText)
        .animation(.easeInOut(duration: 0.8), value: app.sleeping)
        .ignoresSafeArea()
    }
}

/// Fallback for classic savers when the thumb stream fails —
/// previewScene doesn't support classic specs, so point at the web viewer.
private struct ClassicFallbackView: View {
    let channelId: String

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "sparkles.tv")
                .font(.system(size: 64))
                .foregroundStyle(Color.appAccent)
            Text("Classic saver")
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(Color.textPrimary)
            Text("view live at idlescreens.com/c/\(channelId)")
                .font(.system(size: 28))
                .foregroundStyle(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
    }
}

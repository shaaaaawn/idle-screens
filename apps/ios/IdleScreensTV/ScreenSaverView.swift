import SwiftUI

/// Full-screen host for the active channel. Picks the renderer from the
/// effective capability tier; dims to black while the channel sleeps.
/// Chrome-free while watching, but self-explaining: an overlay with the
/// channel name and the way out shows on entry and on any click, then fades.
struct ScreenSaverView: View {
    @Environment(TVAppState.self) private var app
    @State private var showChrome = false
    @State private var chromeTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if app.sleeping {
                // Sleeping is intentional darkness — but say so quietly, or a
                // sleeping channel is indistinguishable from a broken one.
                ZStack {
                    Color.black.ignoresSafeArea()
                    VStack(spacing: 16) {
                        Image(systemName: "moon.zzz")
                            .font(.system(size: 40))
                            .foregroundStyle(Color.textSecondary.opacity(0.5))
                        Text("channel is sleeping")
                            .font(.system(size: 26))
                            .foregroundStyle(Color.textSecondary.opacity(0.4))
                    }
                }
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
            } else if SceneVisibility.verdict(layers: app.compiledScene,
                                              background: app.specBackground) == .invisible {
                // The scene would render as a black screen — indistinguishable
                // from a broken app. Show a designed state instead.
                NotBroadcastingView(channelId: app.selectedChannelId ?? "",
                                    label: channelLabel)
            } else {
                switch app.effectiveTier {
                case .t3:
                    NativeSceneView(
                        layers: app.compiledScene,
                        background: app.specBackground,
                        tier: .t3,
                        watchdog: app.watchdog,
                        onDowngrade: { app.watchdogDidTrigger() }
                    )
                case .t2:
                    // GPU sprite renderer — no watchdog; SpriteKit maintains
                    // its own frame pacing and this tier IS the fallback.
                    SpriteSceneView(
                        layers: app.compiledScene,
                        background: app.specBackground
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

            if showChrome {
                channelChrome
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: app.overlayText)
        .animation(.easeInOut(duration: 0.8), value: app.sleeping)
        .animation(.easeInOut(duration: 0.25), value: showChrome)
        .ignoresSafeArea()
        // The saver has no buttons, so give the remote somewhere to land and
        // handle the exits explicitly — Menu/Back must never feel dead.
        .focusable()
        .onExitCommand { app.exitChannel() }
        .onPlayPauseCommand { revealChrome() }
        .onTapGesture { revealChrome() }
        .onAppear { revealChrome() }
        .onDisappear { chromeTask?.cancel() }
    }

    /// Bottom scrim with the channel name and the way back — visible for a
    /// few seconds on entry and on any click, then gone.
    private var channelChrome: some View {
        VStack {
            Spacer()
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(channelLabel)
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.white)
                    if let viewers = app.viewers, viewers > 0 {
                        HStack(spacing: 8) {
                            Circle().fill(Color.appAccent).frame(width: 10, height: 10)
                            Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
                        }
                        .font(.system(size: 25))
                        .foregroundStyle(.white.opacity(0.7))
                    }
                }
                Spacer()
                Label("Press Back to browse", systemImage: "chevron.backward")
                    .font(.system(size: 25))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.horizontal, 90)
            .padding(.bottom, 60)
            .background(
                LinearGradient(colors: [.clear, .black.opacity(0.7)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 280),
                alignment: .bottom
            )
        }
        .ignoresSafeArea()
    }

    private var channelLabel: String {
        let id = app.selectedChannelId ?? ""
        return app.channels.first(where: { $0.id == id })?.displayLabel ?? id
    }

    private func revealChrome() {
        showChrome = true
        chromeTask?.cancel()
        chromeTask = Task {
            try? await Task.sleep(for: .seconds(3.5))
            guard !Task.isCancelled else { return }
            showChrome = false
        }
    }
}

/// Designed stand-in for scenes that would render invisibly (sub-pixel
/// sprites, dark-on-dark): the channel's generative art, dimmed, with an
/// honest one-liner — never an unexplained black screen.
private struct NotBroadcastingView: View {
    let channelId: String
    let label: String

    var body: some View {
        ZStack {
            ProceduralChannelArt(channelId: channelId)
                .opacity(0.45)
                .ignoresSafeArea()
            VStack(spacing: 18) {
                Text(label)
                    .font(.system(size: 54, weight: .semibold))
                    .foregroundStyle(.white)
                Text("This channel isn't broadcasting visuals right now")
                    .font(.system(size: 27))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .shadow(color: .black.opacity(0.6), radius: 20)
        }
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

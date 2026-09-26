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
                            .font(.system(.title2))
                            .foregroundStyle(Color.textSecondary.opacity(0.55))
                        Text("This channel is sleeping")
                            .font(.tvBody)
                            .foregroundStyle(Color.textSecondary.opacity(0.5))
                    }
                }
            } else if app.isClassicSpec {
                // Classic savers with a native port render locally at 60fps
                // on canvas-capable hardware; the rest use the thumb stream,
                // and on repeated thumb failure a designed ambient fallback.
                if let kind = ClassicSaverKind.supported(id: app.classicSaverId),
                   app.classicRenderTier != nil {
                    ClassicSaverView(kind: kind, seed: app.classicSeed,
                                     tier: app.classicRenderTier ?? .t3,
                                     params: app.classicParams)
                } else if app.thumbFailed {
                    // Never an error message: a seeded ambient scene we can
                    // always render internally, with an honest caption.
                    FallbackSceneView(channelId: app.selectedChannelId ?? "")
                } else {
                    ThumbStreamView(channelId: app.selectedChannelId ?? "")
                }
            } else if app.compiledScene.isEmpty {
                ProgressView()
                    .scaleEffect(2)
            } else if app.activeSequence == nil,
                      SceneVisibility.verdict(layers: app.compiledScene,
                                              background: app.specBackground) == .invisible {
                // Sequence segments skip this gate: a near-black "curtain"
                // act is authored darkness with the next act on a timer,
                // not a channel that stopped broadcasting.
                // The scene would render as a black screen — indistinguishable
                // from a broken app. Show a designed state instead.
                NotBroadcastingView(channelId: app.selectedChannelId ?? "",
                                    label: channelLabel)
            } else {
                Group {
                    switch app.effectiveTier {
                    case .t3:
                        NativeSceneView(
                            layers: app.compiledScene,
                            background: app.specBackground,
                            ghosting: app.specGhosting,
                            renderClass: app.renderClass,
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
                // Sequence segments rebuild the renderer identity and fade
                // per the segment's transition (cut = instant, morph = timed
                // crossfade — true spec-lerp morph is a follow-up).
                // …and a channel change dissolves too, so surfing reads as
                // turning a dial rather than a hard reload.
                .id("\(app.selectedChannelId ?? "")|\(app.sequenceSegmentKey ?? "")|\(timelineKey)")
                .transition(.opacity)
            }

            if let overlay = app.overlayText {
                Text(overlay)
                    .font(.system(.largeTitle, weight: .semibold))
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
        .animation(.easeInOut(duration: max(0.001, app.sequenceCrossfade)),
                   value: app.sequenceSegmentKey)
        .animation(.easeInOut(duration: 0.45), value: app.selectedChannelId)
        .animation(.easeInOut(duration: 0.45), value: app.timeline)
        // Stepping through time is slower than reading a label: keep the
        // chrome up while the viewer is in the past, so "this is not live"
        // never silently disappears.
        .onChange(of: app.timeline) { revealChrome() }
        .animation(.easeInOut(duration: 0.8), value: app.sleeping)
        .animation(.easeInOut(duration: 0.25), value: showChrome)
        .ignoresSafeArea()
        // The saver has no buttons, so give the remote somewhere to land and
        // handle the exits explicitly — Menu/Back must never feel dead.
        .focusable()
        .onExitCommand { app.exitChannel() }
        // Up/Down change the channel without leaving the player — the
        // iPhone feed's vertical axis, and the oldest convention a TV has.
        .onMoveCommand { direction in
            switch direction {
            case .up: app.surf(-1)
            case .down: app.surf(1)
            // The phone's other axis: sideways is time. Left steps into this
            // channel's past, Right comes back toward what is live.
            case .left: app.stepTimeline(older: true)
            case .right: app.stepTimeline(older: false)
            @unknown default: return
            }
            revealChrome()
        }
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
            HStack(alignment: .center, spacing: 32) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(channelLabel)
                        .font(.tvScreenTitle)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    // What is on, and who put it there — the product is
                    // agents authoring these, so the credit belongs on screen.
                    if case .past = app.timeline {
                        Label(pastLine, systemImage: "clock.arrow.circlepath")
                            .font(.tvMeta)
                            .foregroundStyle(Color.appAccent)
                            .lineLimit(1)
                    } else if let credit = creditLine {
                        Text(credit)
                            .font(.tvMeta)
                            .foregroundStyle(.white.opacity(0.75))
                            .lineLimit(1)
                    }
                    if let viewers = app.viewers, viewers > 0 {
                        HStack(spacing: 10) {
                            Circle().fill(Color.appAccent).frame(width: 10, height: 10)
                            Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
                        }
                        .font(.tvMeta)
                        .foregroundStyle(.white.opacity(0.75))
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 8) {
                    if let position = PlayerChrome.positionLine(timeline: app.timeline,
                                                                stops: app.historyStops.count,
                                                                surf: app.surfPosition) {
                        Label(position, systemImage: app.timeline == .live
                              ? "chevron.up.chevron.down" : "chevron.left.chevron.right")
                    }
                    Label("Back to browse", systemImage: "chevron.backward")
                }
                .font(.tvMeta)
                .foregroundStyle(.white.opacity(0.75))
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 28)
            // Glass reads the artwork moving underneath it instead of
            // stamping a black gradient over the thing you came to watch.
            .glassPanel(shape: RoundedRectangle(cornerRadius: TV.panelRadius))
            .padding(.horizontal, TV.gutter)
            .padding(.bottom, TV.gutter)
        }
    }

    private var creditLine: String? {
        PlayerChrome.creditLine(for: app.channels.first { $0.id == app.selectedChannelId })
    }

    private var timelineKey: String { PlayerChrome.timelineKey(app.timeline) }

    private var pastLine: String {
        guard case .past(let i) = app.timeline, app.historyStops.indices.contains(i)
        else { return "Earlier" }
        return PlayerChrome.pastLine(stop: app.historyStops[i], sceneLabel: app.pastScene?.label)
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
            if case .past = app.timeline { return }   // "not live" stays said
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
                    .font(.tvScreenTitle)
                    .foregroundStyle(.white)
                Text("This channel isn't broadcasting visuals right now")
                    .font(.tvBody)
                    .foregroundStyle(.white.opacity(0.65))
            }
            .shadow(color: .black.opacity(0.6), radius: 20)
        }
    }
}


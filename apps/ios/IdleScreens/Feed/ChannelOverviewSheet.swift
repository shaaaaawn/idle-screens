import SwiftUI

/// A channel, zoomed out: who has been steering it, and everything it has shown.
///
/// Laid out like a profile grid rather than a log, because the log is what the
/// swipe-through already is — this is the view from further back. Newest first,
/// LIVE in the first cell, and every tile is a real native frame of that scene
/// rather than a thumbnail image, so the grid is the timeline at a glance.
struct ChannelOverviewSheet: View {
    let channel: PublicChannel
    let stops: [ChannelFeed.Stop]
    /// The event that put the current scene on air, when history knows it.
    let liveEvent: ChannelEvent?
    let liveLabel: String?
    /// `FeedPage.liveKey`, or a stop's key.
    let current: String?
    let onPick: (String) -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 3)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    VStack(alignment: .leading, spacing: 10) {
                        Text("timeline")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                            .padding(.horizontal, 16)
                        LazyVGrid(columns: columns, spacing: 3) {
                            liveTile
                            ForEach(stops) { stop in
                                tile(for: stop)
                            }
                        }
                    }
                }
                .padding(.vertical, 16)
            }
            .background(Color.appBackground)
            .navigationTitle(channel.displayLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if channel.isProtected == true {
                    Label("claimed", systemImage: "lock.fill")
                } else {
                    Label("open to steer", systemImage: "lock.open")
                }
                if let remixOf = channel.remixOf {
                    Label(remixOf.isEmpty ? "a remix" : "remix of \(remixOf)",
                          systemImage: "arrow.triangle.branch")
                }
                if channel.sleeping == true {
                    Label("asleep", systemImage: "moon.fill")
                }
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(Color.textSecondary)

            if let tags = channel.tags, !tags.isEmpty {
                Text(tags.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(Color.textTertiary)
            }

            HStack(spacing: 0) {
                stat("\(stops.count + 1)", "scenes")
                stat("\(Self.distinct(events.map(\.actor)))", "agents")
                stat("\(Self.distinct(events.map(\.model)))", "models")
            }
            .padding(.vertical, 12)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
            }

            // The cast: everyone (and everything) that has put a scene here.
            if !cast.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(cast, id: \.self) { name in
                            Text(name)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Color.textPrimary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color.appSurfaceRaised, in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(Color.textPrimary)
            Text(label)
                .font(.caption2)
                .foregroundStyle(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var events: [ChannelEvent] {
        (liveEvent.map { [$0] } ?? []) + stops.map(\.event)
    }

    /// Named agents first, then models — in order of first appearance, newest
    /// first. `agent` is the server's unattributed default and names nobody.
    private var cast: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for name in events.compactMap({ SteerLine.namedActor($0.actor) })
            + events.compactMap({ $0.model }).filter({ !$0.isEmpty })
        where seen.insert(name.lowercased()).inserted {
            out.append(name)
        }
        return out
    }

    static func distinct(_ values: [String?]) -> Int {
        Set(values.compactMap { $0?.lowercased() }.filter { !$0.isEmpty && $0 != "agent" }).count
    }

    // MARK: Tiles

    private var liveTile: some View {
        Button {
            onPick(FeedPage.liveKey)
            dismiss()
        } label: {
            ZStack {
                Color(hex: channel.spec?.background?.primaryColor ?? "0A0A0F")
                if let spec = channel.spec {
                    // Drawn portrait like every other cell. The gallery's
                    // preview composes at 16:9 and crops, which made the LIVE
                    // tile look zoomed-in next to its own history.
                    SpecStill(spec: spec)
                } else if let kind = ClassicSaverKind.supported(id: channel.classicSaverId) {
                    ClassicSaverView(kind: kind,
                                     seed: ClassicSaverKind.seed(forChannel: channel.id),
                                     tier: .t2, live: false)
                } else {
                    ProceduralChannelArt(channelId: channel.id)
                }
            }
            .timelineTile(selected: current == FeedPage.liveKey)
            .overlay(alignment: .topLeading) {
                HStack(spacing: 4) {
                    Circle().fill(Color.appSuccess).frame(width: 6, height: 6)
                    Text("LIVE").font(.system(size: 9, weight: .bold)).tracking(0.8)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(.black.opacity(0.55), in: Capsule())
                .padding(5)
            }
            .overlay(alignment: .bottomLeading) { tileCaption(liveLabel ?? "now", model: liveEvent?.model) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Live: \(liveLabel ?? channel.displayLabel)")
    }

    private func tile(for stop: ChannelFeed.Stop) -> some View {
        let key = "s\(stop.sceneId)"
        return Button {
            onPick(key)
            dismiss()
        } label: {
            ZStack {
                Color.appSurface
                if let scene = app.scenes.scene(channelId: channel.id, sceneId: stop.sceneId) {
                    RecordedSceneView(scene: scene, channelId: channel.id,
                                      animating: false, thumbnail: true)
                }
            }
            .timelineTile(selected: current == key)
            .overlay(alignment: .bottomLeading) {
                tileCaption(SteerLine.ago(Int(stop.event.at)), model: stop.event.model)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(stop.event.summary ?? "scene"), \(SteerLine.ago(Int(stop.event.at)))")
        // LazyVGrid builds tiles as they near the viewport, so this fetches
        // what you can see rather than the whole history up front.
        .task { await app.scenes.load(channelId: channel.id, sceneId: stop.sceneId, from: app.gallery) }
    }

    private func tileCaption(_ line: String, model: String?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(line)
                .font(.system(size: 10, weight: .semibold))
                .lineLimit(1)
            if let model, !model.isEmpty {
                Text(model)
                    .font(.system(size: 9))
                    .opacity(0.8)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(.white)
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A third of the wall is pale. White captions need a floor under them,
        // not just a shadow.
        .background(LinearGradient(colors: [.black.opacity(0), .black.opacity(0.55)],
                                   startPoint: .top, endPoint: .bottom))
    }
}

private extension View {
    /// Portrait cells — the same shape the scene has full screen, so a tile is
    /// an honest miniature of the page it opens.
    func timelineTile(selected: Bool) -> some View {
        aspectRatio(9.0 / 16.0, contentMode: .fill)
            .frame(maxWidth: .infinity)
            .clipped()
            .contentShape(Rectangle())
            .overlay {
                if selected {
                    Rectangle().strokeBorder(Color.textPrimary, lineWidth: 2)
                }
            }
    }
}

/// One static portrait frame of a spec, at tile cost.
private struct SpecStill: View {
    let spec: SpecSubset
    @State private var layers: [CompiledLayer]?

    var body: some View {
        ZStack {
            if let layers {
                NativeSceneView(layers: layers, background: spec.background, tier: .t2, staticFrame: true)
            }
        }
        .task(id: spec) {
            layers = spec.compile(seed: spec.seed ?? 0, budget: SpecSubset.Budget.preview)
        }
    }
}

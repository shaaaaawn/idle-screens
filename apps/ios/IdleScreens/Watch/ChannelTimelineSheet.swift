import SwiftUI

/// The vertical axis: a channel's past.
///
/// Horizontal is space (which channel, `ChannelPager`); vertical is time. This
/// is the second half of that model, and it only works because the format is
/// deterministic — every past scene is *re-renderable* from its `sceneId`, so
/// these are live frames rather than screenshots of them.
///
/// Provenance leads each row for the same reason it leads the info sheet: the
/// prompt behind a change is the one thing here that a picture cannot show.
struct ChannelTimelineSheet: View {
    let channelId: String
    var canSteer: Bool
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var events: [ChannelEvent] = []
    @State private var phase: Phase = .loading
    @State private var recalling: Int?
    @State private var note: String?

    private enum Phase { case loading, ready, failed }

    /// Only events that put a scene on air can be brought back. A `setParam`
    /// or an overlay has no frame to return to.
    private var recallable: [ChannelEvent] {
        events.filter { $0.sceneId != nil }
    }

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .loading:
                    ProgressView().controlSize(.large).tint(Color.textSecondary)
                case .failed:
                    ContentUnavailableView {
                        Label("Couldn't load the history", systemImage: "clock.badge.exclamationmark")
                    } description: {
                        Text("The channel is fine — this is just its past.")
                    } actions: {
                        Button("Try again") { Task { await load() } }
                    }
                case .ready:
                    if recallable.isEmpty {
                        ContentUnavailableView {
                            Label("Nothing behind this yet", systemImage: "clock")
                        } description: {
                            Text("Scenes published to this channel will collect here.")
                        }
                    } else {
                        list
                    }
                }
            }
            .background(Color.appBackground)
            .navigationTitle("history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private var list: some View {
        List {
            if let note {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
                    .listRowBackground(Color.appSurface)
            }
            ForEach(recallable) { event in
                row(event)
                    .listRowBackground(Color.appSurface)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func row(_ event: ChannelEvent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(event.summary ?? event.kind)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(event.date.formatted(.relative(presentation: .named)))
                    .font(.caption2)
                    .foregroundStyle(Color.textTertiary)
            }

            if let intent = event.intent, !intent.isEmpty {
                Text(intent)
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(3)
            }

            HStack(spacing: 10) {
                if let model = event.model, !model.isEmpty {
                    Label(model, systemImage: "cpu")
                        .font(.caption2)
                        .foregroundStyle(Color.textTertiary)
                }
                Spacer(minLength: 0)
                if canSteer {
                    Button {
                        recall(event)
                    } label: {
                        if recalling == event.sceneId {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Bring back", systemImage: "arrow.uturn.backward")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.textPrimary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(recalling != nil)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        phase = .loading
        do {
            events = try await app.gallery.fetchHistory(channelId: channelId)
            phase = .ready
        } catch {
            phase = .failed
        }
    }

    private func recall(_ event: ChannelEvent) {
        guard let sceneId = event.sceneId,
              let token = app.token(for: channelId) else { return }
        recalling = sceneId
        Task {
            defer { recalling = nil }
            do {
                try await app.mcp.recall(channelId: channelId, token: token, sceneId: sceneId)
                note = "brought back — it's on air now"
            } catch {
                note = "couldn't bring that one back"
            }
        }
    }
}

import SwiftUI

/// What is on air, and how it got there. Provenance leads — see below.
struct SceneInfoSheet: View {
    let session: ChannelSession
    let channelId: String
    @Environment(AppState.self) private var app
    @State private var events: [ChannelEvent] = []
    @State private var loadingHistory = true

    /// The most recent event that actually says who/what/why. Plenty of events
    /// carry no attribution; showing "agent" with no model and no intent is
    /// worse than showing nothing.
    private var provenance: ChannelEvent? {
        events.first { $0.hasAttribution }
    }

    var body: some View {
        NavigationStack {
            List {
                // Provenance leads. It is the one thing this product knows
                // that a screenshot of the same scene would not.
                if let event = provenance {
                    Section("how this scene got here") {
                        if let intent = event.intent, !intent.isEmpty {
                            Text(intent)
                                .font(.callout)
                                .foregroundStyle(Color.textPrimary)
                        }
                        LabeledContent("author", value: event.actor ?? "agent")
                        if let model = event.model, !model.isEmpty {
                            LabeledContent("model", value: model)
                        }
                        if let harness = event.harness, !harness.isEmpty {
                            LabeledContent("via", value: harness)
                        }
                        LabeledContent("when",
                                       value: event.date.formatted(.relative(presentation: .named)))
                    }
                } else if loadingHistory {
                    Section("how this scene got here") {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("reading the channel's history…")
                                .font(.footnote)
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                }

                Section("scene") {
                    LabeledContent("channel", value: channelId)
                    LabeledContent("scene", value: session.sceneLabel ?? "—")
                    LabeledContent("layers", value: "\(session.compiledScene.count)")
                    LabeledContent("sprites",
                                   value: "\(session.compiledScene.reduce(0) { $0 + $1.entities.count })")
                    if let viewers = session.viewers {
                        LabeledContent("viewers", value: "\(viewers)")
                    }
                }
                Section("rendering") {
                    LabeledContent("live scene", value: "web engine")
                    LabeledContent("controls", value: "native")
                    LabeledContent("history", value: "native re-render")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .navigationTitle("Scene")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                defer { loadingHistory = false }
                events = (try? await app.gallery.fetchHistory(channelId: channelId)) ?? []
            }
        }
    }
}

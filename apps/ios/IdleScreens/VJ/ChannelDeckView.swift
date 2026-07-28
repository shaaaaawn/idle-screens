import SwiftUI

/// Live control deck for one channel: publish savers, shuffle the seed,
/// sleep/wake, and flash overlay text. Polls channel state every 10s.
struct ChannelDeckView: View {
    let credential: ChannelCredential
    @Environment(AppState.self) private var app

    @State private var state: ChannelState?
    @State private var overlayText = ""
    @State private var actionError: String?
    @State private var isSending = false

    private var isSleeping: Bool { state?.sleeping == true }

    var body: some View {
        List {
            Section("now") {
                LabeledContent("status", value: isSleeping ? "sleeping" : "live")
                    .foregroundStyle(isSleeping ? Color.textSecondary : Color.appSuccess)
                LabeledContent("viewers", value: state?.viewers.map(String.init) ?? "—")
                LabeledContent("scene", value: state?.scene?.label ?? state?.scene?.id ?? "—")
            }

            // Mixing beats starting over: adopt any live scene onto this
            // channel, keeping its id, viewers and paired screens.
            Section("mix in a scene") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(app.channels.filter { $0.spec != nil && $0.id != credential.channelId }) { channel in
                            Button {
                                run {
                                    try await app.adoptScene(
                                        from: channel.id, into: credential.channelId)
                                    state = try? await app.fetchState(for: credential.channelId)
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    ScenePreviewView(spec: channel.spec!, fallbackSeed: channel.id)
                                        .frame(width: 124, height: 70)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 8)
                                                .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
                                        }
                                    Text(channel.displayLabel)
                                        .font(.caption2)
                                        .foregroundStyle(Color.textSecondary)
                                        .lineLimit(1)
                                        .frame(width: 124, alignment: .leading)
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(isSending)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 0))
            }

            Section("savers") {
                if app.savers.isEmpty, let error = app.vjError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Color.textSecondary)
                } else if app.savers.isEmpty {
                    ProgressView()
                } else {
                    ForEach(app.savers) { saver in
                        Button {
                            run { try await app.publish(saver: saver, to: credential.channelId) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(saver.displayLabel)
                                    .foregroundStyle(Color.textPrimary)
                                if let description = saver.description {
                                    Text(description)
                                        .font(.caption)
                                        .foregroundStyle(Color.textSecondary)
                                        .lineLimit(2)
                                }
                            }
                        }
                        .disabled(isSending)
                    }
                }
            }

            Section("controls") {
                if !app.pairedScreens.isEmpty {
                    Button {
                        run {
                            let delivered = await app.pushToAllScreens(channelId: credential.channelId)
                            if delivered == 0 {
                                actionError = await app.pairPushError ?? "Couldn't reach your screens."
                            }
                        }
                    } label: {
                        Label(app.pairedScreens.count > 1 ? "Play on all screens" : "Play on your screen",
                              systemImage: "play.tv")
                    }
                    .disabled(isSending)
                }

                Button {
                    run { _ = try await app.shuffleSeed(for: credential.channelId) }
                } label: {
                    Label("Shuffle seed", systemImage: "shuffle")
                }
                .disabled(isSending)

                Button {
                    run {
                        try await app.setSleeping(!isSleeping, for: credential.channelId)
                        state = try await app.fetchState(for: credential.channelId)
                    }
                } label: {
                    Label(isSleeping ? "Wake" : "Sleep", systemImage: isSleeping ? "sun.max" : "moon")
                }
                .disabled(isSending)
            }

            Section("overlay") {
                TextField("flash text to all viewers", text: $overlayText)
                    .autocorrectionDisabled()
                Button {
                    let text = overlayText
                    overlayText = ""
                    run { try await app.sendOverlay(text, to: credential.channelId) }
                } label: {
                    Label("Send overlay", systemImage: "text.bubble")
                }
                .disabled(overlayText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.appBackground)
        .navigationTitle(credential.label)
        .navigationBarTitleDisplayMode(.inline)
        .alert("Action failed", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("OK") { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
        .task { await app.loadSavers() }
        .task {
            // Poll state while the deck is visible.
            while !Task.isCancelled {
                state = try? await app.fetchState(for: credential.channelId)
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func run(_ action: @escaping @Sendable () async throws -> Void) {
        isSending = true
        Task {
            defer { isSending = false }
            do {
                try await action()
            } catch {
                actionError = error.localizedDescription
            }
        }
    }
}

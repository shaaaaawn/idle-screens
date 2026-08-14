import SwiftUI

// glassCapsule / glassPanel live in Theme/Glass.swift — shared by the composer
// chrome and the pairing surfaces.

/// The composer: the channel's controls, one drag away from the scene.
///
/// Peeked (150pt) it's a transport strip — what's playing plus the two actions
/// you reach for mid-watch. Dragged up it becomes the full deck: swap the
/// scene, reseed, sleep, flash text. Channels you don't own show the same
/// surface with a single honest CTA — remix it and every control unlocks,
/// because the fork is yours.
struct ComposerSheet: View {
    let channelId: String
    let session: ChannelSession
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var overlayText = ""
    @State private var busy = false
    @State private var note: String?
    @State private var savingPreset = false
    @State private var presetName = ""

    private var canSteer: Bool { app.token(for: channelId) != nil }

    /// You created this channel, but there is no token behind it — a failed
    /// Keychain write, or a device that restored the list without the
    /// credentials. Without this state the app tells the OWNER of a channel
    /// "watching — remix to steer", which reads as "this was never yours".
    private var ownedButUnlocked: Bool {
        !canSteer && app.credentials.contains { $0.channelId == channelId }
    }

    private var steerStatus: String {
        if canSteer { return "you can steer this" }
        return ownedButUnlocked ? "yours — token missing on this device"
                                : "watching — remix to steer"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    transport
                    presetShelf
                    if canSteer {
                        sceneShelf
                        overlayRow
                    } else {
                        unownedCallout
                    }
                    if let note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(Color.textSecondary)
                    }
                }
                .padding(20)
            }
            .background(Color.appBackground)
            .navigationTitle("compose")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Name this preset", isPresented: $savingPreset) {
                TextField("cozy evening", text: $presetName)
                    .textInputAutocapitalization(.never)
                Button("Save") { commitPreset() }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("The scene on air right now, saved under a name you can bring back.")
            }
        }
    }

    // MARK: Peek — what you see without dragging

    private var transport: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(session.sceneLabel ?? "no scene")
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(1)
                Text(steerStatus)
                    .font(.caption)
                    .foregroundStyle(ownedButUnlocked ? Color.appDanger : Color.textSecondary)
            }
            Spacer()
            if canSteer {
                action("shuffle") {
                    _ = try? await app.shuffleSeed(for: channelId)
                    note = "reseeded"
                }
                action(session.sleeping ? "play.fill" : "pause.fill") {
                    try? await app.setSleeping(!session.sleeping, for: channelId)
                }
            }
        }
    }

    private func action(_ icon: String, run: @escaping () async -> Void) -> some View {
        Button {
            busy = true
            Task {
                await run()
                busy = false
            }
        } label: {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.appBackground)
                .frame(width: 42, height: 42)
                .background(Color.textPrimary, in: Circle())
        }
        .disabled(busy)
    }

    // MARK: Expanded

    /// Presets are the user's OWN saved moments, so they come before the
    /// catalogue of everyone else's channels. The server has been sending
    /// these on every state push all along.
    @ViewBuilder
    private var presetShelf: some View {
        if canSteer {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("your presets")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                    Button {
                        savingPreset = true
                        presetName = ""
                    } label: {
                        Label("Save this", systemImage: "bookmark")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                    }
                    .disabled(!session.hasScene || busy)
                }

                if session.presets.isEmpty {
                    Text("Save a scene you like and it lands here, ready to bring back exactly as it looked.")
                        .font(.caption)
                        .foregroundStyle(Color.textTertiary)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(session.presets, id: \.self) { name in
                                Button {
                                    recall(name)
                                } label: {
                                    Label(name, systemImage: "bookmark.fill")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(Color.textPrimary)
                                        .padding(.horizontal, 13)
                                        .padding(.vertical, 9)
                                        .glassCapsule(shape: Capsule())
                                }
                                .disabled(busy)
                            }
                        }
                        .padding(.vertical, 1)
                    }
                }
            }
        }
    }

    private func recall(_ name: String) {
        guard let token = app.token(for: channelId) else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.mcp.recall(channelId: channelId, token: token, presetName: name)
                note = "recalled “\(name)”"
            } catch {
                note = "couldn't recall “\(name)”"
            }
        }
    }

    private func commitPreset() {
        let name = presetName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let token = app.token(for: channelId) else { return }
        savingPreset = false
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.mcp.savePreset(channelId: channelId, token: token, name: name)
                note = "saved “\(name)”"
            } catch {
                note = "couldn't save “\(name)”"
            }
        }
    }

    private var sceneShelf: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("swap the scene")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(app.channels.filter { $0.spec != nil && $0.id != channelId }) { channel in
                        Button {
                            busy = true
                            Task {
                                try? await app.adoptScene(from: channel.id, into: channelId)
                                note = "now playing \(channel.displayLabel)"
                                busy = false
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                ScenePreviewView(spec: channel.spec!, fallbackSeed: channel.id)
                                    .frame(width: 120, height: 68)
                                    .clipShape(RoundedRectangle(cornerRadius: 9))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 9)
                                            .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
                                    }
                                Text(channel.displayLabel)
                                    .font(.caption2)
                                    .foregroundStyle(Color.textSecondary)
                                    .lineLimit(1)
                                    .frame(width: 120, alignment: .leading)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                    }
                }
            }
        }
    }

    private var overlayRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("flash a message")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            HStack(spacing: 10) {
                TextField("on every screen watching", text: $overlayText)
                    .autocorrectionDisabled()
                    .padding(11)
                    .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Color.textPrimary)
                Button("Send") {
                    let text = overlayText
                    overlayText = ""
                    busy = true
                    Task {
                        try? await app.sendOverlay(text, to: channelId)
                        busy = false
                    }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.appBackground)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Color.textPrimary, in: Capsule())
                .disabled(overlayText.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            }
        }
    }

    /// Not yours — one honest action rather than disabled controls.
    private var unownedCallout: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Remix to make it yours")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            Text("Forks this exact scene into a channel you control, so you can steer it without changing what anyone else is watching.")
                .font(.caption)
                .foregroundStyle(Color.textSecondary)
            Button {
                busy = true
                Task {
                    if let credential = try? await app.remix(channelId) {
                        note = "created \(credential.label) — steer it from Create"
                    } else {
                        note = "couldn't remix — try again"
                    }
                    busy = false
                }
            } label: {
                Label(busy ? "Remixing…" : "Remix this scene", systemImage: "arrow.triangle.branch")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appBackground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.textPrimary, in: Capsule())
            }
            .disabled(busy)
        }
    }
}

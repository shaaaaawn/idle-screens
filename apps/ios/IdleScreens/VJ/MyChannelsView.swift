import SwiftUI

/// Channels the user controls — create new ones, or attach an existing channel by token.
struct MyChannelsView: View {
    @Environment(AppState.self) private var app
    @State private var showingNew = false
    @State private var showingAdd = false
    @State private var createdToken: String?
    @State private var path: [ChannelCredential] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Creation is the point of this tab — lead with it.
                    Button {
                        showingNew = true
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "wand.and.stars")
                                .font(.title2)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("New channel")
                                    .font(.headline)
                                Text("Starts live with a scene on air")
                                    .font(.caption)
                                    .opacity(0.7)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.subheadline.weight(.semibold))
                                .opacity(0.5)
                        }
                        .foregroundStyle(Color.appBackground)
                        .padding(18)
                        .frame(maxWidth: .infinity)
                        .background(Color.textPrimary, in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)

                    if app.credentials.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Nothing of yours yet")
                                .font(.headline)
                                .foregroundStyle(Color.textPrimary)
                            Text("Create a channel to publish scenes and steer them live — or add one you already control with its token.")
                                .font(.subheadline)
                                .foregroundStyle(Color.textSecondary)
                            Button("Add with a token") { showingAdd = true }
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Color.textPrimary)
                                .padding(.top, 4)
                        }
                        .cardStyle()
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("your channels")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(Color.textPrimary)
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 150), spacing: 12)],
                                spacing: 16
                            ) {
                                ForEach(app.credentials) { credential in
                                    NavigationLink(value: credential) {
                                        channelCard(credential)
                                    }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button("Remove", role: .destructive) {
                                            app.removeChannel(credential)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(Color.appBackground)
            .navigationDestination(for: ChannelCredential.self) { credential in
                ChannelDeckView(credential: credential)
            }
            .navigationTitle("create")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("New channel", systemImage: "plus.rectangle") { showingNew = true }
                        Button("Add existing", systemImage: "key") { showingAdd = true }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable { await app.loadGallery() }
            .sheet(isPresented: $showingNew) {
                NewChannelSheet { token in
                    createdToken = token
                    // Land the user in their new channel's deck, not back on
                    // the list — creation should end somewhere steerable.
                    if let credential = app.credentials.last {
                        path = [credential]
                    }
                }
            }
            .sheet(isPresented: $showingAdd) {
                AddExistingChannelSheet()
            }
            // Remix stores its token server-side in the same call, so there's
            // nothing to reveal — only show the sheet for a real new token.
            .sheet(isPresented: Binding(
                get: { !(createdToken ?? "").isEmpty },
                set: { if !$0 { createdToken = nil } }
            )) {
                if let token = createdToken {
                    TokenRevealSheet(token: token, channelId: app.credentials.last?.channelId)
                }
            }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }

    /// Poster card for a channel you control — live scene when the gallery
    /// knows it, plus what it's currently doing.
    private func channelCard(_ credential: ChannelCredential) -> some View {
        let channel = app.channels.first { $0.id == credential.channelId }
        return VStack(alignment: .leading, spacing: 8) {
            ZStack {
                if let spec = channel?.spec {
                    ScenePreviewView(spec: spec, fallbackSeed: credential.channelId)
                } else {
                    LinearGradient(colors: [Color.appSurfaceRaised, Color.appBackground],
                                   startPoint: .top, endPoint: .bottom)
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(alignment: .topLeading) {
                if channel?.sleeping == true {
                    Label("asleep", systemImage: "moon.fill")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color.textPrimary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.55), in: Capsule())
                        .padding(6)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
            }

            Text(credential.label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.textPrimary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(credential.channelId)
                .font(.caption2)
                .foregroundStyle(Color.textTertiary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - New channel sheet

/// Creating a channel starts from *something* — a scene you already like,
/// or a classic saver — never a blank channel you then have to figure out.
/// Picking a source and hitting Create is one step: the server forks it
/// atomically (remixChannel) so the channel is yours the moment it exists.
private struct NewChannelSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onCreated: (String) -> Void

    private enum Source: Hashable {
        case blank
        case channel(String)
        case saver(String)
    }

    @State private var label = ""
    @State private var source: Source = .blank
    @State private var error: String?
    @State private var working = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name")
                            .font(.headline)
                            .foregroundStyle(Color.textPrimary)
                        TextField("living room", text: $label)
                            .textFieldStyle(.plain)
                            .padding(12)
                            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(Color.textPrimary)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Start from")
                            .font(.headline)
                            .foregroundStyle(Color.textPrimary)
                        Text("Remix any channel's current scene, or open with a classic saver.")
                            .font(.caption)
                            .foregroundStyle(Color.textSecondary)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                sourceTile(.blank, title: "Surprise me") {
                                    ZStack {
                                        LinearGradient(colors: [Color.appSurfaceRaised, Color.appBackground],
                                                       startPoint: .top, endPoint: .bottom)
                                        Image(systemName: "dice")
                                            .font(.title2)
                                            .foregroundStyle(Color.textSecondary)
                                    }
                                }
                                ForEach(app.channels.filter { $0.spec != nil }) { channel in
                                    sourceTile(.channel(channel.id), title: channel.displayLabel) {
                                        ScenePreviewView(spec: channel.spec!, fallbackSeed: channel.id)
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
                .padding(20)
            }
            .background(Color.appBackground)
            .navigationTitle("New channel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Creating…" : "Create") { create() }
                        .disabled(working || app.isWorking)
                }
            }
        }
    }

    private func sourceTile<Art: View>(
        _ value: Source, title: String, @ViewBuilder art: () -> Art
    ) -> some View {
        let selected = source == value
        return Button {
            source = value
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                art()
                    .frame(width: 132, height: 74)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(selected ? Color.textPrimary : Color.appBorder.opacity(0.5),
                                          lineWidth: selected ? 2 : 1)
                    }
                Text(title)
                    .font(.caption)
                    .foregroundStyle(selected ? Color.textPrimary : Color.textSecondary)
                    .lineLimit(1)
                    .frame(width: 132, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
    }

    private func create() {
        working = true
        Task {
            defer { working = false }
            do {
                switch source {
                case .blank, .saver:
                    let token = try await app.createChannel(label: label, tags: [])
                    dismiss()
                    onCreated(token)
                case .channel(let sourceId):
                    // Fork keeps the scene AND hands us the token in one call.
                    _ = try await app.remix(sourceId, label: label)
                    dismiss()
                    onCreated("")
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Add existing channel sheet

private struct AddExistingChannelSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var channelId = ""
    @State private var token = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Channel ID", text: $channelId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Token (isk_…)", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        // Capability tokens aren't passwords — suppress the
                        // "Save Password?" prompt autofill would offer.
                        .textContentType(.oneTimeCode)
                } footer: {
                    Text("The token is verified with the channel before it is saved.")
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Add existing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Verify & add") { add() }
                        .disabled(channelId.isEmpty || token.isEmpty || app.isWorking)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func add() {
        Task {
            do {
                try await app.addExistingChannel(channelId: channelId, token: token)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - One-time token reveal

private struct TokenRevealSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    let token: String
    var channelId: String?
    @State private var sentToTV = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 40))
                .foregroundStyle(Color.appAccent)

            Text("Your channel is live")
                .font(.title2)
                .foregroundStyle(Color.textPrimary)

            Text("A starter scene is already on air — steer it from the deck behind this sheet. This capability token is shown once; it's saved to your Keychain, so copy it only if you'll VJ from another device.")
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if let channelId, !app.pairedScreens.isEmpty {
                Button {
                    Task {
                        sentToTV = await app.pushToAllScreens(channelId: channelId) > 0
                    }
                } label: {
                    Label(sentToTV ? "Playing on your screen" : "Play on your screen",
                          systemImage: sentToTV ? "checkmark.circle.fill" : "play.tv")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(sentToTV ? .appSuccess : .appAccent)
                .disabled(sentToTV)
                .padding(.horizontal, 40)
            }

            Text(token)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.textPrimary)
                .padding(12)
                .background(Color.appSurfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 24)
                .textSelection(.enabled)

            Button {
                UIPasteboard.general.string = token
            } label: {
                Label("Copy token", systemImage: "doc.on.doc")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(.appPrimary)
            .padding(.horizontal, 40)

            Spacer()

            Button("Done") { dismiss() }
                .foregroundStyle(Color.textSecondary)
                .padding(.bottom, 24)
        }
        .background(Color.appBackground.ignoresSafeArea())
        .presentationDetents([.medium])
    }
}

// MARK: - Card container

private extension View {
    func cardStyle() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
            }
    }
}

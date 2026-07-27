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
            .sheet(isPresented: Binding(
                get: { createdToken != nil },
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

private struct NewChannelSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onCreated: (String) -> Void

    @State private var label = ""
    @State private var tags = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Label", text: $label)
                    TextField("Tags (comma separated)", text: $tags)
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New channel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }
                        .disabled(app.isWorking)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func create() {
        let tagList = tags
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        Task {
            do {
                let token = try await app.createChannel(label: label, tags: tagList)
                dismiss()
                onCreated(token)
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

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
            List {
                ForEach(app.credentials) { credential in
                    NavigationLink(value: credential) {
                        HStack(spacing: 12) {
                            // Live preview when the channel is in the public
                            // gallery (specs come along for free with it).
                            if let spec = app.channels.first(where: { $0.id == credential.channelId })?.spec {
                                ScenePreviewView(spec: spec, fallbackSeed: credential.channelId)
                                    .frame(width: 84, height: 47)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(credential.label)
                                    .foregroundStyle(Color.textPrimary)
                                Text(credential.channelId)
                                    .font(.caption)
                                    .foregroundStyle(Color.textSecondary)
                            }
                        }
                    }
                    .listRowBackground(Color.appBackground)
                }
                .onDelete { indexSet in
                    indexSet.forEach { app.removeChannel(app.credentials[$0]) }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .overlay {
                if app.credentials.isEmpty {
                    ContentUnavailableView {
                        Label("No channels", systemImage: "slider.horizontal.3")
                    } description: {
                        Text("Create a channel or add one you already control.")
                    }
                }
            }
            .navigationDestination(for: ChannelCredential.self) { credential in
                ChannelDeckView(credential: credential)
            }
            .navigationTitle("vj")
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

            if let channelId, app.pairedTV != nil {
                Button {
                    Task {
                        sentToTV = await app.pushToTV(channelId: channelId)
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

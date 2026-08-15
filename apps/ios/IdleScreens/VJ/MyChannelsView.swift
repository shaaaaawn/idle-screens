import SwiftUI

/// Channels the user controls — create new ones, or attach an existing channel by token.
struct MyChannelsView: View {
    @Environment(AppState.self) private var app
    @State private var showingNew = false
    @State private var showingAdd = false
    @State private var createdToken: String?
    @State private var path: [ChannelCredential] = []
    @State private var handoff: TokenHandoff?

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
            .sheet(item: $handoff) { item in
                TokenHandoffSheet(handoff: item)
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
        // The token is in the Keychain the whole time — refusing to show it
        // again just because its one-time sheet was dismissed strands the
        // user from a credential they still hold.
        .contextMenu {
            Button {
                UIPasteboard.general.string = credential.channelId
            } label: {
                Label("Copy channel ID", systemImage: "doc.on.doc")
            }
            if let token = app.token(for: credential.channelId) {
                Button {
                    UIPasteboard.general.string = token
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy steering token", systemImage: "key")
                }
                // Handing the token to someone else is DELEGATION, not backup —
                // tokens already sync to your own devices via iCloud Keychain.
                // Whoever holds this can publish to the channel, and there is no
                // per-person revoke: the only undo is rotating the token, which
                // cuts off every holder including you. Say that before sharing,
                // not after.
                Button {
                    handoff = TokenHandoff(credential: credential, token: token)
                } label: {
                    Label("Give someone control…", systemImage: "person.badge.key")
                }
            }
            ShareLink(item: app.gallery.viewerURL(for: credential.channelId)) {
                Label("Share channel", systemImage: "square.and.arrow.up")
            }
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
                            .foregroundStyle(Color.appDanger)
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

    /// Local checks first — a malformed token shouldn't cost a round trip
    /// that comes back as an opaque failure.
    private var tokenProblem: String? { ChannelTokenFormat.tokenProblem(token) }

    private var canSubmit: Bool {
        !channelId.isEmpty && ChannelTokenFormat.isPlausibleToken(token) && !app.isWorking
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Channel ID or link", text: $channelId)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            // Paste a viewer URL and keep only the id — the
                            // link is what people actually have to hand.
                            .onChange(of: channelId) { _, new in
                                if new.contains("/"),
                                   let id = ChannelTokenFormat.channelId(from: new) {
                                    channelId = id
                                }
                            }
                        pasteButton(into: $channelId, transform: {
                            ChannelTokenFormat.channelId(from: $0)
                        })
                    }
                } header: {
                    Text("Channel")
                } footer: {
                    Text("Paste the channel's link and we'll keep just the id.")
                }

                Section {
                    HStack {
                        SecureField("isk_…", text: $token)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            // Capability tokens aren't passwords — suppress the
                            // "Save Password?" prompt autofill would offer.
                            .textContentType(.oneTimeCode)
                        pasteButton(into: $token, transform: {
                            ChannelTokenFormat.normalizeToken($0)
                        })
                    }
                } header: {
                    Text("Token")
                } footer: {
                    if let tokenProblem {
                        Label(tokenProblem, systemImage: "exclamationmark.circle.fill")
                            .foregroundStyle(Color.appDanger)
                    } else {
                        Text("Verified with the channel before it's saved to your Keychain.")
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.appDanger)
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
                    if app.isWorking {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Verify & add") { add() }
                            .disabled(!canSubmit)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    /// `hasStrings` is the only pasteboard query that doesn't trigger the
    /// system "would like to paste" alert — the clipboard's CONTENT is read
    /// inside the tap handler, so the prompt only appears once the user has
    /// actually asked for a paste.
    @ViewBuilder
    private func pasteButton(into field: Binding<String>,
                             transform: @escaping (String) -> String?) -> some View {
        if UIPasteboard.general.hasStrings {
            Button {
                if let clipboard = UIPasteboard.general.string,
                   let value = transform(clipboard) {
                    field.wrappedValue = value
                }
            } label: {
                Image(systemName: "doc.on.clipboard")
                    .foregroundStyle(Color.textSecondary)
            }
            .buttonStyle(.plain)
        }
    }

    private func add() {
        error = nil
        Task {
            do {
                try await app.addExistingChannel(
                    channelId: channelId,
                    token: ChannelTokenFormat.normalizeToken(token))
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                dismiss()
            } catch {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Token reveal (new channel)

private struct TokenRevealSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    let token: String
    var channelId: String?
    @State private var sentToTV = false
    @State private var copied = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 40))
                .foregroundStyle(Color.textPrimary)

            Text("Your channel is live")
                .font(.title2)
                .foregroundStyle(Color.textPrimary)

            Text("A starter scene is already on air — steer it from the deck behind this sheet. The token below is saved to your Keychain; copy it if you'll VJ from another device. You can get it again any time by long-pressing the channel.")
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
                .tint(sentToTV ? .appSuccess : .textPrimary)
                .foregroundStyle(sentToTV ? Color.textPrimary : Color.appBackground)
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
                copied = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } label: {
                // Copying to a clipboard is invisible — without the state
                // change there's nothing to tell you the tap registered.
                Label(copied ? "Copied" : "Copy token",
                      systemImage: copied ? "checkmark" : "doc.on.doc")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(copied ? .appSuccess : .textPrimary)
            .foregroundStyle(copied ? Color.textPrimary : Color.appBackground)
            .padding(.horizontal, 40)
            .animation(.easeOut(duration: 0.2), value: copied)

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

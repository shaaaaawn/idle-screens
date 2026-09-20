import SwiftUI
import UIKit

/// The keys to one channel: who can get in, and how far.
///
/// This replaces handing over the owner key. That was the only option the app
/// had, and it came with a warning it could do nothing about: whoever holds the
/// owner key is you, and the only undo is rotating it, which locks everyone out.
/// The server's roles exist to make that warning unnecessary — mint a labelled
/// key that can edit, or only view, and revoke exactly that one later.
///
/// There are still no accounts. A key belongs to the channel, not to a person;
/// the label is a note to yourself about who you gave it to.
struct ChannelKeysSheet: View {
    let credential: ChannelCredential
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var grants: [KeyGrant] = []
    @State private var phase: Phase = .loading
    @State private var newRole: ChannelRole = .editor
    @State private var newLabel = ""
    @State private var minting = false
    @State private var minted: Minted?
    @State private var problem: String?
    @State private var handoff: TokenHandoff?

    private enum Phase { case loading, ready, failed }
    private struct Minted: Identifiable {
        let key: MintedKey
        let role: ChannelRole
        let label: String
        var id: String { key.id }
    }

    private var channelId: String { credential.channelId }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("This key", selection: $newRole) {
                        Label("Can edit", systemImage: ChannelRole.editor.icon).tag(ChannelRole.editor)
                        Label("Can view", systemImage: ChannelRole.viewer.icon).tag(ChannelRole.viewer)
                    }
                    .pickerStyle(.segmented)
                    TextField("Who is it for? (kitchen tv, pax…)", text: $newLabel)
                        .textInputAutocapitalization(.never)
                    Button {
                        mint()
                    } label: {
                        if minting { ProgressView() } else { Label("Make a key", systemImage: "plus.circle.fill") }
                    }
                    .disabled(minting || newLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                } header: {
                    Text("Share this channel")
                } footer: {
                    Text(newRole == .editor
                         ? "They can change the scene, steer it, schedule it and use presets. They can't make keys, delete the channel or take it over."
                         : "They can watch — which matters when a channel is private. They can't change anything.")
                }

                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.appDanger) }
                }

                Section("Keys you've made") {
                    switch phase {
                    case .loading:
                        HStack { ProgressView().controlSize(.small); Text("reading the keyring…").foregroundStyle(.secondary) }
                    case .failed:
                        Button("Couldn't load the keys — try again") { Task { await load() } }
                    case .ready:
                        if grants.isEmpty {
                            Text("None yet. Only you can steer this channel.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(grants) { grant in
                            HStack(spacing: 12) {
                                Image(systemName: (grant.role ?? .viewer).icon)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 22)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(grant.label?.isEmpty == false ? grant.label! : "unlabelled")
                                    Text((grant.role ?? .viewer).label)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .swipeActions {
                                Button("Revoke", role: .destructive) { revoke(grant) }
                            }
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        if let token = app.token(for: channelId) {
                            handoff = TokenHandoff(credential: credential, token: token)
                        }
                    } label: {
                        Label("Hand over the owner key…", systemImage: "key.horizontal")
                    }
                } footer: {
                    Text("Only to give the channel away. For sharing, make a key above — it can be revoked on its own.")
                }
            }
            .navigationTitle(credential.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $minted) { item in
                MintedKeySheet(channelId: channelId, channelLabel: credential.label,
                               token: item.key.token, role: item.role, label: item.label)
            }
            .sheet(item: $handoff) { TokenHandoffSheet(handoff: $0) }
        }
        .task { await load() }
    }

    private func load() async {
        guard let token = app.token(for: channelId) else { phase = .failed; return }
        phase = .loading
        do {
            grants = try await app.mcp.listTokens(channelId: channelId, token: token)
            phase = .ready
        } catch {
            phase = .failed
        }
    }

    private func mint() {
        guard let token = app.token(for: channelId) else { return }
        let label = newLabel.trimmingCharacters(in: .whitespaces)
        minting = true
        problem = nil
        Task {
            defer { minting = false }
            do {
                let key = try await app.mcp.createToken(channelId: channelId, token: token,
                                                        role: newRole, label: label)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                minted = Minted(key: key, role: newRole, label: label)
                newLabel = ""
                await load()
            } catch {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                problem = error.localizedDescription
            }
        }
    }

    private func revoke(_ grant: KeyGrant) {
        guard let token = app.token(for: channelId) else { return }
        Task {
            do {
                try await app.mcp.revokeToken(channelId: channelId, token: token, id: grant.id)
                grants.removeAll { $0.id == grant.id }
            } catch {
                problem = "Couldn't revoke that key: \(error.localizedDescription)"
            }
        }
    }
}

/// The one moment a minted key is visible. The server keeps only its hash.
private struct MintedKeySheet: View {
    let channelId: String
    let channelLabel: String
    let token: String
    let role: ChannelRole
    let label: String
    @Environment(\.dismiss) private var dismiss

    /// Opens in the app and adds the key in one tap.
    private var link: String { "idlescreens://channel/\(channelId)?token=\(token)" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: role.icon)
                    .font(.system(size: 38))
                    .foregroundStyle(Color.textPrimary)
                    .padding(.top, 28)
                Text("A key for \(label)")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                Text("\(role.label) · \(channelLabel)\nThis is the only time it's shown. If it's lost, revoke it and make another.")
                    .font(.subheadline)
                    .foregroundStyle(Color.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                ShareLink(item: link) {
                    Label("Send the key", systemImage: "square.and.arrow.up")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .foregroundStyle(Color.appBackground)
                        .background(Color.textPrimary, in: Capsule())
                }
                .padding(.horizontal, 32)

                Button {
                    UIPasteboard.general.string = token
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy the raw key (for an agent)", systemImage: "doc.on.doc")
                        .font(.subheadline)
                        .foregroundStyle(Color.textSecondary)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .background(Color.appBackground.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

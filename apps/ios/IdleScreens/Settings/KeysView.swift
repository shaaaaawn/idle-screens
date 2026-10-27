import SwiftUI

/// The keys on this device's ring: what each one lets you do, backing them
/// up, and letting one go. A drill-in from Settings, so a list of secrets is
/// never the first thing that page shows.
struct KeysView: View {
    @Environment(AppState.self) private var app
    @State private var showingAddKey = false
    @State private var handoff: TokenHandoff?
    @State private var keysFor: ChannelCredential?
    @State private var removing: ChannelCredential?
    /// Owner keys can end the channel itself, not just forget it here.
    @State private var deleteError: String?
    @State private var confirmingBackup = false
    @State private var backupFile: URL?

    var body: some View {
        List {
            if app.credentials.isEmpty {
                ContentUnavailableView {
                    Label("No keys yet", systemImage: "key")
                } description: {
                    Text("A key lets you steer a channel. Start one from Agents, or add a key you already have.")
                } actions: {
                    Button("Add a key…") { showingAddKey = true }
                }
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(app.credentials) { keyRow($0) }
                } footer: {
                    Text("Keys sync to your other Apple devices through iCloud Keychain.")
                }
                .houseRow()
            }

            Section {
                Button { showingAddKey = true } label: {
                    Label("Add a key…", systemImage: "plus")
                }
                if !backupEntries.isEmpty {
                    Button { confirmingBackup = true } label: {
                        Label("Back up all keys…", systemImage: "square.and.arrow.down.on.square")
                    }
                }
            } footer: {
                if !backupEntries.isEmpty {
                    Text("A backup restores your keys anywhere else — a computer, an Android phone, a browser.")
                }
            }
            .houseRow()
        }
        .houseList()
        .navigationTitle("keys")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingAddKey) { AddExistingChannelSheet() }
        .sheet(item: $handoff) { TokenHandoffSheet(handoff: $0) }
        .sheet(item: $keysFor) { ChannelKeysSheet(credential: $0) }
        .alert("Remove the key for \(removing?.label ?? "this channel")?", isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Remove key", role: .destructive) {
                if let removing { app.removeChannel(removing) }
                removing = nil
            }
            Button("Cancel", role: .cancel) { removing = nil }
        } message: {
            Text("The channel keeps running. Without a backup of this key, this device — and every device synced with it — can no longer steer it.")
        }
        .alert("Couldn't delete the channel", isPresented: Binding(
            get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "")
        }
        .alert("Back up \(backupEntries.count == 1 ? "your key" : "all \(backupEntries.count) keys")?",
               isPresented: $confirmingBackup) {
            Button("Make the backup") { backupFile = writeBackup() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This makes one private file with every key on this \(ThisDevice.noun). Anyone who has the file controls every channel in it — save it somewhere only you can open.")
        }
        .sheet(item: Binding(get: { backupFile.map(BackupFile.init) }, set: { if $0 == nil { backupFile = nil } })) { file in
            BackupReadySheet(file: file.url, count: backupEntries.count)
                .presentationDetents([.medium])
        }
    }

    private func keyRow(_ credential: ChannelCredential) -> some View {
        let token = app.token(for: credential.channelId)
        let role = app.role(for: credential.channelId)
        return Menu {
            if let token {
                Button {
                    handoff = TokenHandoff(credential: credential, token: token)
                } label: { Label("Back up or move this key…", systemImage: "square.and.arrow.up") }
            }
            if role?.canAdminister == true {
                Button { keysFor = credential } label: {
                    Label("Share & keys…", systemImage: "person.2.badge.key")
                }
            }
            Button(role: .destructive) { removing = credential } label: {
                Label("Remove from this device", systemImage: "key.slash")
            }
            if token != nil, role == .owner {
                // The server asks before it deletes — every time, naming what
                // goes and whether screens are watching — so there is no
                // second dialog here; that read as asking twice.
                Button(role: .destructive) {
                    Task {
                        do { try await app.deleteChannel(credential) }
                        catch where error.isMCPCancellation {}
                        catch { deleteError = error.mcpDisplayText }
                    }
                } label: {
                    Label("Delete channel…", systemImage: "trash")
                }
            }
        } label: {
            HStack(spacing: 12) {
                SettingsIcon(systemName: token == nil ? "key.slash" : (role?.icon ?? "key.fill"),
                             tint: token == nil ? .appDanger : .appPrimary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(credential.label)
                        .foregroundStyle(Color.textPrimary)
                    Text(token == nil ? "missing on this \(ThisDevice.noun)" : (role?.label ?? "key"))
                        .font(.caption)
                        .foregroundStyle(token == nil ? Color.appDanger : Color.textSecondary)
                }
                Spacer()
                Image(systemName: "ellipsis")
                    .foregroundStyle(Color.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .swipeActions {
            Button("Remove", role: .destructive) { removing = credential }
        }
    }

    private var backupEntries: [KeyBackup.Entry] {
        app.credentials.compactMap { credential in
            app.token(for: credential.channelId).map {
                KeyBackup.Entry(channelId: credential.channelId, label: credential.label,
                                role: app.role(for: credential.channelId)?.rawValue, token: $0)
            }
        }
    }

    /// Written to the app's temporary directory, handed to the share sheet,
    /// and deleted when the sheet closes — the secrets don't linger on disk.
    private func writeBackup() -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(KeyBackup.fileName())
        do {
            try KeyBackup.document(backupEntries).write(to: url, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            return url
        } catch {
            return nil
        }
    }
}

private struct BackupFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// The file is made; now choose where it goes. Deleted from the app's
/// temporary directory once this closes.
private struct BackupReadySheet: View {
    let file: URL
    let count: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Backup ready", systemImage: "checkmark.seal.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            Text("\(count == 1 ? "1 key" : "\(count) keys"), in one text file. Save it to Files, a password manager or a drive only you can open. Each key restores with one tap from its link.")
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
            ShareLink(item: file) {
                Label("Save the backup…", systemImage: "square.and.arrow.up")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .foregroundStyle(Color.appBackground)
                    .background(Color.textPrimary, in: Capsule())
            }
            Button("Done") { dismiss() }
                .frame(maxWidth: .infinity)
                .foregroundStyle(Color.textSecondary)
        }
        .padding(24)
        .background(Color.appBackground.ignoresSafeArea())
        .onDisappear { try? FileManager.default.removeItem(at: file) }
    }
}

/// Channels you follow, newest-first in Channels. Swipe one away to stop.
struct FollowingView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        let followed = app.follows.followed.sorted { label($0).localizedCaseInsensitiveCompare(label($1)) == .orderedAscending }
        List {
            if followed.isEmpty {
                ContentUnavailableView("Nobody yet", systemImage: "heart",
                                       description: Text("Follow a channel from Watch and it comes first in Channels."))
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(followed, id: \.self) { id in
                        HStack(spacing: 12) {
                            thumb(id)
                            Text(label(id))
                                .foregroundStyle(Color.textPrimary)
                                .lineLimit(1)
                            Spacer()
                        }
                        .swipeActions {
                            Button("Unfollow", role: .destructive) {
                                withAnimation { _ = app.follows.toggle(id) }
                            }
                        }
                    }
                } footer: {
                    Text("Only you can see who you follow. It syncs through iCloud Keychain.")
                }
                .houseRow()
            }
        }
        .houseList()
        .navigationTitle("following")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func label(_ id: String) -> String {
        app.channels.first { $0.id == id }?.displayLabel ?? id
    }

    @ViewBuilder
    private func thumb(_ id: String) -> some View {
        Group {
            if let spec = app.channels.first(where: { $0.id == id })?.spec {
                ScenePreviewView(spec: spec, fallbackSeed: id, live: false)
            } else {
                Color.appSurfaceRaised
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// Channels hidden from this device with Report → Hide. Swipe, or tap Show
/// again, to bring one back.
struct HiddenChannelsView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        let hidden = app.hidden.ids.sorted()
        List {
            if hidden.isEmpty {
                ContentUnavailableView("Nothing hidden", systemImage: "eye",
                                       description: Text("Channels you hide from a report land here."))
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(hidden, id: \.self) { id in
                        HStack {
                            Text(id)
                                .foregroundStyle(Color.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Button("Show again") { Task { await app.unhideChannel(id) } }
                                .font(.footnote.weight(.semibold))
                                .buttonStyle(.borderless)
                        }
                        .swipeActions {
                            Button("Show again") { Task { await app.unhideChannel(id) } }
                                .tint(.appPrimary)
                        }
                    }
                } footer: {
                    Text("Hidden on this device only. Nobody is told.")
                }
                .houseRow()
            }
        }
        .houseList()
        .navigationTitle("hidden")
        .navigationBarTitleDisplayMode(.inline)
    }
}

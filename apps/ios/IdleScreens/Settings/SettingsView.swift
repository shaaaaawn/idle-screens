import SwiftUI

/// Everything this app holds on your behalf, in one place: the screens it can
/// push to, the keys on its ring, who you follow, and how all of that syncs.
///
/// There are no accounts. "You" is the contents of this page — which is why it
/// says plainly where each thing is stored and what happens if you remove it.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showingAddKey = false
    @State private var handoff: TokenHandoff?
    @State private var keysFor: ChannelCredential?
    @State private var removing: ChannelCredential?
    @State private var confirmingRemoval = false
    /// Collapsed by default: a list of secrets is not the first thing this
    /// page should show, and it grows with every channel.
    @State private var keysExpanded = false
    @State private var confirmingBackup = false
    @State private var backupFile: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    screensSection
                    keysSection
                    followingSection
                    aboutSection
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            // Screen presence and channel names are the two things here that
            // go stale.
            .refreshable {
                async let screens: Void = app.refreshScreenStatuses()
                async let gallery: Void = app.loadGallery()
                _ = await (screens, gallery)
            }
            .background(Color.appBackground.ignoresSafeArea())
            .navigationTitle("settings")
        }
        .sheet(isPresented: $showingAddKey) { AddExistingChannelSheet() }
        .sheet(item: $handoff) { TokenHandoffSheet(handoff: $0) }
        .sheet(item: $keysFor) { ChannelKeysSheet(credential: $0) }
        .alert("Remove the key for \(removing?.label ?? "this channel")?", isPresented: $confirmingRemoval) {
            Button("Remove key", role: .destructive) {
                if let removing { app.removeChannel(removing) }
                removing = nil
            }
            Button("Cancel", role: .cancel) { removing = nil }
        } message: {
            Text("The channel keeps running. Without a backup of this key, this device — and every device synced with it — can no longer steer it.")
        }
    }

    // MARK: Screens

    private var screensSection: some View {
        section("screens & sync", footer: "Manage paired Apple TV, Mac and Linux screens, open a channel's controls on a computer, and see what syncs through iCloud.") {
            NavigationLink {
                PairedTVView(embedded: true)
            } label: {
                HStack {
                    row(icon: "tv.badge.wifi", title: "Screens & sync", detail: screensDetail)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                }
                // Without this only the words are tappable; the gap between
                // "Screens" and the count swallows the tap.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var screensDetail: String {
        let screens = app.pairedScreens
        guard !screens.isEmpty else { return "none paired" }
        let connected = screens.filter { $0.presence() == .connected }.count
        return connected > 0 ? "\(screens.count) paired · \(connected) connected" : "\(screens.count) paired"
    }

    // MARK: Keys

    private var keysSection: some View {
        section("keys", footer: "A key is what lets you steer a channel. They sync to your other Apple devices through iCloud Keychain; back them all up for anywhere else.") {
            Button {
                withAnimation(.spring(duration: 0.3, bounce: 0.1)) { keysExpanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "key.fill")
                        .foregroundStyle(Color.appPrimary)
                        .frame(width: 26)
                    Text(app.credentials.isEmpty ? "No keys yet"
                         : app.credentials.count == 1 ? "1 key" : "\(app.credentials.count) keys")
                        .foregroundStyle(Color.textPrimary)
                    // Worth seeing even folded: a key that is not on this device.
                    if missingKeys > 0 {
                        Label("\(missingKeys) missing", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.appDanger)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                        .rotationEffect(.degrees(keysExpanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(keysExpanded ? "Hides your keys" : "Shows your keys")

            if keysExpanded {
                Divider().overlay(Color.appBorder.opacity(0.5))
                ForEach(app.credentials) { credential in
                    keyRow(credential)
                    Divider().overlay(Color.appBorder.opacity(0.5))
                }
            }

            if !backupEntries.isEmpty {
                Button { confirmingBackup = true } label: {
                    Label("Back up all keys…", systemImage: "square.and.arrow.down.on.square")
                        .foregroundStyle(Color.appPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Button {
                showingAddKey = true
            } label: {
                Label("Add a key…", systemImage: "plus")
                    .foregroundStyle(Color.appPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .alert("Back up \(backupEntries.count == 1 ? "your key" : "all \(backupEntries.count) keys")?",
               isPresented: $confirmingBackup) {
            Button("Make the backup") { backupFile = writeBackup() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This makes one private file with every key on this phone. Anyone who has the file controls every channel in it — save it somewhere only you can open.")
        }
        .sheet(item: Binding(get: { backupFile.map(BackupFile.init) }, set: { if $0 == nil { backupFile = nil } })) { file in
            BackupReadySheet(file: file.url, count: backupEntries.count)
                .presentationDetents([.medium])
        }
    }

    private var missingKeys: Int {
        app.credentials.filter { app.token(for: $0.channelId) == nil }.count
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
            Button(role: .destructive) { removing = credential; confirmingRemoval = true } label: {
                Label("Remove from this device", systemImage: "trash")
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: token == nil ? "key.slash" : "key.fill")
                    .foregroundStyle(token == nil ? Color.appDanger : Color.appPrimary)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(credential.label)
                        .foregroundStyle(Color.textPrimary)
                    Text(token == nil ? "key missing on this device"
                                      : (role?.rawValue ?? "key"))
                        .font(.caption)
                        .foregroundStyle(token == nil ? Color.appDanger : Color.textSecondary)
                }
                Spacer()
                Image(systemName: "ellipsis")
                    .foregroundStyle(Color.textTertiary)
            }
        }
    }

    // MARK: Following

    private var followingSection: some View {
        section("following") {
            let followed = app.follows.followed.sorted()
            if followed.isEmpty {
                Text("Follow a channel from the feed and it shows up first in Channels.")
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
            } else {
                ForEach(followed, id: \.self) { id in
                    HStack {
                        Text(app.channels.first { $0.id == id }?.displayLabel ?? id)
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        Button("Unfollow") {
                            withAnimation { _ = app.follows.toggle(id) }
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.appPrimary)
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: About

    private var aboutSection: some View {
        section("about") {
            row(icon: "info.circle", title: "Version", detail: Self.version)
            row(icon: "server.rack", title: "Server", detail: URL(string: Config.baseURL)?.host ?? Config.baseURL)
            if let site = URL(string: Config.baseURL) {
                Link(destination: site) {
                    row(icon: "safari", title: "Open idlescreens.com", detail: "")
                }
            }
        }
    }

    /// A titled card: header, rows separated by hairlines, optional footnote.
    private func section<Content: View>(_ title: String, footer: String? = nil,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.textSecondary)
            VStack(alignment: .leading, spacing: 14) { content() }
                .settingsCard()
            if let footer {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(Color.textTertiary)
            }
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(short) (\(build))"
    }

    private func row(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.appPrimary)
                .frame(width: 26)
            Text(title).foregroundStyle(Color.textPrimary)
            Spacer()
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
                .lineLimit(1)
        }
    }
}

private extension View {
    func settingsCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
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

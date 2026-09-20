import SwiftUI
import UIKit

/// Screens & sync (inside Settings): everything that leaves this phone.
///
/// Three jobs, in the order you reach for them: manage the screens you have
/// paired, carry a key to a desktop browser, and see what syncs on its own.
/// It used to end in a copy of the gallery for "pick something to push" — but
/// browsing is what the Channels tab is for, and pushing lives on every
/// channel in the feed. Here a screen's own menu offers a short send list.
struct PairedTVView: View {
    /// Pushed from Settings it must not bring a second navigation stack.
    var embedded = false
    @Environment(AppState.self) private var app
    @State private var showingScanner = false
    @State private var manualCode = ""
    @State private var sendingTo: PairedScreen?
    @State private var toast: String?
    @State private var screenKind: ScreenKind = .appleTV
    @State private var showingAddScreen = false
    /// The Add sheet needs its OWN scanner binding. Two `.sheet` modifiers on
    /// the same view share one presentation anchor, so asking the root to show
    /// the scanner while it is already presenting "Add a screen" silently does
    /// nothing — which made Scan QR dead for anyone who already had a screen.
    @State private var showingScannerInSheet = false

    /// The three screen hosts, each with the one step that puts it into
    /// pairing mode — shown one at a time instead of as a run-on sentence.
    enum ScreenKind: String, CaseIterable, Identifiable {
        case appleTV, mac, linux
        var id: String { rawValue }

        var title: String {
            switch self {
            case .appleTV: "Apple TV"
            case .mac: "Mac"
            case .linux: "Linux"
            }
        }

        var icon: String {
            switch self {
            case .appleTV: "appletv"
            case .mac: "menubar.rectangle"
            case .linux: "desktopcomputer"
            }
        }

        var instruction: String {
            switch self {
            case .appleTV: "Open idle screens on the TV → Settings → Pair iPhone."
            case .mac: "Menu bar → idle screens → Content → Pair iPhone…"
            case .linux: "Tray icon → Pair phone."
            }
        }
    }

    var body: some View {
        Group {
            if embedded { screensRoot } else { NavigationStack { screensRoot } }
        }
        .sheet(isPresented: $showingAddScreen) {
            NavigationStack {
                ScrollView { pairingForm(scanBinding: $showingScannerInSheet).padding(20) }
                    .background(Color.appBackground.ignoresSafeArea())
                    .navigationTitle("Add a screen")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showingAddScreen = false }
                        }
                    }
            }
            // A failure from last time is not news about this attempt.
            .onAppear { app.pairClaimError = nil }
            // Presented from INSIDE this sheet, so it gets this sheet's anchor.
            .sheet(isPresented: $showingScannerInSheet) {
                PairScannerSheet(
                    onCode: { code in
                        showingScannerInSheet = false
                        claim(code)
                    },
                    onEnterManually: { showingScannerInSheet = false })
            }
        }
        .sheet(isPresented: $showingScanner) {
            PairScannerSheet(
                onCode: { code in
                    showingScanner = false
                    claim(code)
                },
                onEnterManually: {
                    showingScanner = false
                    showingAddScreen = true
                })
        }
        .task {
            await app.refreshScreenStatuses()
        }
    }

    // MARK: Unpaired

    private var screensRoot: some View {
        Group {
            if !app.pairedScreens.isEmpty {
                pairedContent
            } else {
                unpairedContent
            }
        }
        .navigationTitle("screens & sync")
        .navigationBarTitleDisplayMode(embedded ? .inline : .automatic)
        .background(Color.appBackground.ignoresSafeArea())
    }

    private var unpairedContent: some View {
        ScrollView {
            VStack(spacing: 28) {
                // Hero — one clear primary action, centered.
                VStack(spacing: 14) {
                    Image(systemName: "tv.badge.wifi")
                        .font(.system(size: 46, weight: .light))
                        .foregroundStyle(Color.textPrimary)
                    Text("Pair a screen")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                    Text("Steer any Apple TV, Mac, or Linux display from your phone.")
                        .font(.subheadline)
                        .foregroundStyle(Color.textSecondary)
                        .multilineTextAlignment(.center)

                    Button {
                        showingScanner = true
                    } label: {
                        Label("Scan QR code", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 30)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.textPrimary)
                    .foregroundStyle(Color.appBackground)
                    .controlSize(.large)
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 12)

                pairingForm(scanBinding: $showingScanner)
                desktopSection
                syncSection
            }
            .padding(20)
        }
    }

    /// The pairing steps themselves — shared by the empty state and the
    /// "Add a screen" sheet, so a second screen can be added by CODE, not
    /// just QR (the Mac and Linux hosts only ever show a code).
    ///
    /// `scanBinding` is passed in rather than fixed because the two callers
    /// present the scanner from different anchors: the empty state is the root
    /// view, the Add sheet is itself a presented sheet. A single shared binding
    /// works for exactly one of them and silently fails for the other.
    @ViewBuilder
    private func pairingForm(scanBinding: Binding<Bool>) -> some View {
        VStack(spacing: 28) {
                // Step 1, per platform — pick your screen, get one instruction.
                VStack(alignment: .leading, spacing: 12) {
                    stepHeader(1, "Put your screen in pairing mode")
                    Picker("Screen", selection: $screenKind) {
                        ForEach(ScreenKind.allCases) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }
                    .pickerStyle(.segmented)
                    Label(screenKind.instruction, systemImage: screenKind.icon)
                        .font(.subheadline)
                        .foregroundStyle(Color.textSecondary)
                }
                .cardStyle()

                // Step 2 — the code itself. Six cells that submit on their own
                // once full; no "Pair" button to hunt for.
                VStack(alignment: .leading, spacing: 14) {
                    stepHeader(2, "Enter the code, or scan the QR")

                    PairCodeField(code: $manualCode, isBusy: app.isPairing) { code in
                        claim(code)
                    }

                    // The claim error belongs HERE, under the field that
                    // caused it — not in a card at the bottom of the form.
                    if let error = app.pairClaimError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(Color.appDanger)
                            .transition(.opacity)
                    }

                    HStack(spacing: 12) {
                        if app.isPairing {
                            HStack(spacing: 8) {
                                ProgressView().controlSize(.small).tint(Color.textSecondary)
                                Text("Pairing…")
                                    .font(.caption)
                                    .foregroundStyle(Color.textSecondary)
                            }
                        } else {
                            Text("Codes last five minutes.")
                                .font(.caption)
                                .foregroundStyle(Color.textTertiary)
                        }
                        Spacer(minLength: 8)
                        Button {
                            scanBinding.wrappedValue = true
                        } label: {
                            Label("Scan QR", systemImage: "qrcode.viewfinder")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.textPrimary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .glassCapsule(shape: Capsule())
                        }
                    }
                }
                .cardStyle()
                .animation(.easeOut(duration: 0.2), value: app.pairClaimError)
                .animation(.easeOut(duration: 0.2), value: app.isPairing)
        }
    }

    /// Claim a code, and say so out loud when it lands — a sheet that just
    /// vanishes leaves the user unsure whether anything happened.
    private func claim(_ code: String) {
        Task {
            if await app.claimPairCode(code) {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                manualCode = ""
                showingAddScreen = false
                showingScanner = false
            } else {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            }
        }
    }

    private func stepHeader(_ number: Int, _ title: String) -> some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.appBackground)
                .frame(width: 22, height: 22)
                .background(Color.textPrimary, in: Circle())
            Text(title)
                .font(.headline)
                .foregroundStyle(Color.textPrimary)
        }
    }

    // MARK: Paired

    /// Push target: one screen, or everything at once.
    private var pairedContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                screensSection
                desktopSection
                syncSection
            }
            .padding(20)
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassCapsule(shape: Capsule())
                    .padding(.bottom, 24)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: toast)
        .sheet(item: $sendingTo) { screen in
            SendToScreenSheet(screen: screen) { channelId, label in
                Task {
                    let ok = await app.push(channelId: channelId, to: screen)
                    flash(ok ? "\(label) → \(screen.kind.label)"
                             : app.pairPushError ?? "\(screen.kind.label) isn't answering")
                }
            }
        }
        .refreshable { await app.refreshScreenStatuses() }
        .task {
            // Poll while this page is on screen so the dots stay honest.
            while !Task.isCancelled {
                await app.refreshScreenStatuses()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func flash(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toast == message { toast = nil }
        }
    }

    // MARK: Screens

    private var screensSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("screens", detail: "Apple TV, Mac and Linux displays this phone can steer.")
            VStack(spacing: 0) {
                ForEach(app.pairedScreens) { screen in
                    screenRow(screen)
                    Divider().overlay(Color.appBorder.opacity(0.5))
                }
                Button {
                    showingAddScreen = true
                } label: {
                    Label("Pair a screen…", systemImage: "plus")
                        .foregroundStyle(Color.appPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }
        }
    }

    private func screenRow(_ screen: PairedScreen) -> some View {
        let presence = screen.presence()
        return Menu {
            Button { sendingTo = screen } label: { Label("Send a channel…", systemImage: "play.tv") }
            if let watching = screen.channelId {
                Button {
                    Task {
                        let ok = await app.push(channelId: watching, to: screen)
                        flash(ok ? "\(screen.kind.label) answered" : "\(screen.kind.label) isn't answering")
                    }
                } label: { Label("Check it's there", systemImage: "dot.radiowaves.left.and.right") }
            }
            Button(role: .destructive) { app.unpair(screen) } label: {
                Label("Unpair", systemImage: "minus.circle")
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: screen.kind.icon)
                    .font(.title3)
                    .foregroundStyle(Color.textPrimary)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(screen.kind.label)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Color.textPrimary)
                    Text(screen.statusText)
                        .font(.caption)
                        .foregroundStyle(presence == .notAnswering ? Color.appWarning : Color.textSecondary)
                        .lineLimit(1)
                    if let watching = screen.channelId {
                        Text("showing \(app.channels.first { $0.id == watching }?.displayLabel ?? watching)")
                            .font(.caption)
                            .foregroundStyle(Color.textTertiary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                presenceDot(presence)
                Image(systemName: "ellipsis")
                    .foregroundStyle(Color.textTertiary)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
    }

    // MARK: Desktop & web

    /// A key held here, opened on a computer. The website takes a key from a
    /// `?token=` link, stores it in that browser and strips it from the address
    /// bar — so AirDropping the link to a Mac is the whole sync.
    private var desktopSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("desktop & web",
                          detail: "Open a channel's controls at idlescreens.com on a computer, already unlocked. AirDrop the link to your Mac, or send it to yourself.")
            VStack(spacing: 0) {
                let keyed = app.credentials.filter { app.token(for: $0.channelId) != nil }
                if keyed.isEmpty {
                    Text("No keys on this phone yet. Create a channel, or add a key in Settings, and it can be opened on a computer from here.")
                        .font(.footnote)
                        .foregroundStyle(Color.textSecondary)
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(keyed) { credential in
                        if let link = Self.webRemoteLink(channelId: credential.channelId,
                                                         token: app.token(for: credential.channelId)) {
                            ShareLink(item: link,
                                      subject: Text("Steer \(credential.label)"),
                                      message: Text("Opens \(credential.label) unlocked. Anyone with this link can steer it.")) {
                                HStack(spacing: 12) {
                                    Image(systemName: "laptopcomputer.and.arrow.down")
                                        .foregroundStyle(Color.appPrimary)
                                        .frame(width: 30)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(credential.label).foregroundStyle(Color.textPrimary)
                                        Text(app.role(for: credential.channelId)?.rawValue ?? "key")
                                            .font(.caption)
                                            .foregroundStyle(Color.textSecondary)
                                    }
                                    Spacer()
                                    Image(systemName: "square.and.arrow.up")
                                        .foregroundStyle(Color.textTertiary)
                                }
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if credential.id != keyed.last?.id {
                                Divider().overlay(Color.appBorder.opacity(0.5))
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }
            Text("The link carries the key. Send it only to yourself or someone you would hand the channel to.")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
        }
    }

    /// `https://idlescreens.com/channel/<id>/remote?token=…` — the web remote's
    /// own hand-in. nil for anything the site would refuse, so a malformed
    /// key never becomes a link someone pastes around.
    static func webRemoteLink(channelId: String, token: String?,
                              baseURL: String = Config.baseURL) -> URL? {
        guard let token, WebSceneView.isWellFormed(token),
              let id = ChannelTokenFormat.sanitizeId(channelId),
              var parts = URLComponents(string: baseURL) else { return nil }
        parts.path = "/channel/\(id)/remote"
        parts.queryItems = [URLQueryItem(name: "token", value: token)]
        return parts.url
    }

    // MARK: Sync

    private var syncSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("sync", detail: nil)
            VStack(spacing: 12) {
                syncRow("key.icloud", "Keys", "iCloud Keychain")
                syncRow("star", "Following", "iCloud Keychain")
                syncRow("tv", "Paired screens", "this phone only")
            }
            .cardStyle()
            Text("Keys and follows reach your other Apple devices through iCloud Keychain, end-to-end encrypted — iOS Settings → your name → iCloud → Passwords. Screens are paired per phone: pair again on another device.")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
        }
    }

    private func syncRow(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(Color.appPrimary).frame(width: 30)
            Text(title).foregroundStyle(Color.textPrimary)
            Spacer()
            Text(detail).font(.subheadline).foregroundStyle(Color.textSecondary)
        }
    }

    private func sectionHeader(_ title: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            if let detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
            }
        }
    }

    /// Green means PROOF, not history. A filled dot only for a screen that has
    /// just answered; amber for one that just didn't; a hollow ring when all we
    /// know is that it connected once — which is most of the time, and is not
    /// the same as being on.
    @ViewBuilder
    private func presenceDot(_ presence: PairedScreen.Presence) -> some View {
        switch presence {
        case .connected:
            Circle().fill(Color.appSuccess).frame(width: 8, height: 8)
                .accessibilityLabel("Connected")
        case .notAnswering:
            Circle().fill(Color.appWarning).frame(width: 8, height: 8)
                .accessibilityLabel("Not answering")
        case .unknown, .never:
            Circle().strokeBorder(Color.textTertiary, lineWidth: 1.5).frame(width: 8, height: 8)
                .accessibilityLabel(presence == .never ? "Never connected" : "Status unknown")
        }
    }

    /// A shelf of channel poster cards that push on tap.
}

// MARK: - Send sheet

/// A short list, not a gallery: what you follow and what you own, then
/// everything else — enough to put something on a screen without browsing.
private struct SendToScreenSheet: View {
    let screen: PairedScreen
    let onPick: (_ channelId: String, _ label: String) -> Void
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var groups: [(String, [(String, String)])] {
        let mine = app.credentials.map { ($0.channelId, $0.label) }
        let followed = app.follows.channels(in: app.channels).map { ($0.id, $0.displayLabel) }
        let taken = Set((mine + followed).map(\.0))
        let rest = app.channels.filter { !taken.contains($0.id) }.map { ($0.id, $0.displayLabel) }
        let match: ((String, String)) -> Bool = { pair in
            query.isEmpty || pair.0.localizedCaseInsensitiveContains(query)
                || pair.1.localizedCaseInsensitiveContains(query)
        }
        return [("yours", mine.filter(match)), ("following", followed.filter(match)),
                ("all channels", rest.filter(match))].filter { !$0.1.isEmpty }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(groups, id: \.0) { title, items in
                    Section(title) {
                        ForEach(items, id: \.0) { id, label in
                            Button {
                                onPick(id, label)
                                dismiss()
                            } label: {
                                HStack {
                                    Text(label).foregroundStyle(Color.textPrimary)
                                    Spacer()
                                    if screen.channelId == id {
                                        Text("on now").font(.caption).foregroundStyle(Color.textSecondary)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .searchable(text: $query, prompt: "Channel")
            .navigationTitle("Send to \(screen.kind.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Card container

private extension View {
    /// Grouped-list look without a List: raised surface, hairline, padding.
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

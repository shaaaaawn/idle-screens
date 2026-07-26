import SwiftUI

/// The "Screens" tab: pair with any idle screen — Apple TV, a Mac, or a
/// Linux display — by scanning its QR (or typing the
/// code), see what it's watching, and push any channel to it.
struct PairedTVView: View {
    @Environment(AppState.self) private var app
    @State private var showingScanner = false
    @State private var manualCode = ""
    @State private var justPushed: String?
    @State private var screenKind: ScreenKind = .appleTV

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
        NavigationStack {
            Group {
                if app.pairedTV != nil {
                    pairedContent
                } else {
                    unpairedContent
                }
            }
            .navigationTitle("screens")
            .background(Color.appBackground.ignoresSafeArea())
        }
        .sheet(isPresented: $showingScanner) {
            PairScannerSheet { code in
                showingScanner = false
                Task { await app.claimPairCode(code) }
            }
        }
        .task {
            await app.refreshTVStatus()
        }
    }

    // MARK: Unpaired

    private var unpairedContent: some View {
        ScrollView {
            VStack(spacing: 28) {
                // Hero — one clear primary action, centered.
                VStack(spacing: 14) {
                    Image(systemName: "tv.badge.wifi")
                        .font(.system(size: 46, weight: .light))
                        .foregroundStyle(Color.appPrimary)
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
                    .tint(.appPrimary)
                    .controlSize(.large)
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 12)

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

                // Step 2 — code entry with a real, obvious button.
                VStack(alignment: .leading, spacing: 12) {
                    stepHeader(2, "Scan the QR, or enter its code")
                    HStack(spacing: 10) {
                        TextField("K7M2PW", text: $manualCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(.title3, design: .monospaced))
                            .multilineTextAlignment(.center)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity)
                            .background(Color.appBackground, in: RoundedRectangle(cornerRadius: 10))

                        Button {
                            let code = manualCode
                            manualCode = ""
                            Task { await app.claimPairCode(code) }
                        } label: {
                            if app.isPairing {
                                ProgressView().tint(Color.appBackground)
                                    .frame(width: 62, height: 44)
                            } else {
                                Text("Pair")
                                    .font(.headline)
                                    .frame(width: 62, height: 44)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.appAccent)
                        .foregroundStyle(Color.appBackground)
                        .disabled(manualCode.trimmingCharacters(in: .whitespaces).isEmpty || app.isPairing)
                    }
                    Text("Codes expire five minutes after your screen shows them.")
                        .font(.caption)
                        .foregroundStyle(Color.textTertiary)
                }
                .cardStyle()

                if let error = app.pairPushError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .cardStyle()
                }
            }
            .padding(20)
        }
    }

    private func stepHeader(_ number: Int, _ title: String) -> some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.appBackground)
                .frame(width: 22, height: 22)
                .background(Color.appPrimary, in: Circle())
            Text(title)
                .font(.headline)
                .foregroundStyle(Color.textPrimary)
        }
    }

    // MARK: Paired

    private var pairedContent: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    Image(systemName: "tv.badge.wifi")
                        .font(.largeTitle)
                        .foregroundStyle(Color.appPrimary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Screen paired")
                            .font(.headline)
                        Text(app.pairedTV?.channelId.map { "Watching \($0)" } ?? "Not watching yet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            if let error = app.pairPushError {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if !app.credentials.isEmpty {
                Section("Your channels") {
                    ForEach(app.credentials) { credential in
                        pushRow(id: credential.channelId, label: credential.label)
                    }
                }
            }

            Section("Gallery") {
                if app.channels.isEmpty {
                    Text("No channels loaded yet.")
                        .foregroundStyle(.secondary)
                }
                ForEach(app.channels) { channel in
                    pushRow(id: channel.id, label: channel.displayLabel)
                }
            }

            Section {
                Button("Unpair TV", role: .destructive) {
                    app.unpairTV()
                }
            }
        }
        .refreshable {
            await app.refreshTVStatus()
            await app.loadGallery()
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }

    private func pushRow(id: String, label: String) -> some View {
        Button {
            Task {
                if await app.pushToTV(channelId: id) {
                    justPushed = id
                    try? await Task.sleep(for: .seconds(2))
                    if justPushed == id { justPushed = nil }
                }
            }
        } label: {
            HStack {
                Text(label)
                Spacer()
                if justPushed == id {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else if app.pairedTV?.channelId == id {
                    Text("On TV")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: "play.tv")
                        .foregroundStyle(Color.appPrimary)
                }
            }
        }
        .disabled(app.isPairing)
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

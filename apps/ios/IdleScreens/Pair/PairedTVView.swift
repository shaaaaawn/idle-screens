import SwiftUI

/// The "TV" tab: pair with an Apple TV by scanning its QR (or typing the
/// code), see what it's watching, and push any channel to it.
struct PairedTVView: View {
    @Environment(AppState.self) private var app
    @State private var showingScanner = false
    @State private var manualCode = ""
    @State private var justPushed: String?

    var body: some View {
        NavigationStack {
            Group {
                if app.pairedTV != nil {
                    pairedContent
                } else {
                    unpairedContent
                }
            }
            .navigationTitle("TV")
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
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Pair your Apple TV", systemImage: "appletv")
                        .font(.headline)
                    Text("On the TV, open Settings → Pair iPhone, then scan the QR code — or type the code below.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button {
                        showingScanner = true
                    } label: {
                        Label("Scan QR code", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 8)
            }

            Section("Enter code") {
                TextField("e.g. K7M2PW", text: $manualCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                Button("Pair") {
                    let code = manualCode
                    manualCode = ""
                    Task { await app.claimPairCode(code) }
                }
                .disabled(manualCode.trimmingCharacters(in: .whitespaces).isEmpty || app.isPairing)
            }

            if let error = app.pairPushError {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
    }

    // MARK: Paired

    private var pairedContent: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    Image(systemName: "appletv.fill")
                        .font(.largeTitle)
                        .foregroundStyle(Color.appPrimary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Apple TV paired")
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

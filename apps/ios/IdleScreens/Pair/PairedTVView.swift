import SwiftUI
import UIKit

/// The "Screens" tab: pair with any idle screen — Apple TV, a Mac, or a
/// Linux display — by scanning its QR (or typing the
/// code), see what it's watching, and push any channel to it.
struct PairedTVView: View {
    @Environment(AppState.self) private var app
    @State private var showingScanner = false
    @State private var manualCode = ""
    @State private var justPushed: String?
    @State private var screenKind: ScreenKind = .appleTV
    @State private var selectedScreen: String?
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
        NavigationStack {
            Group {
                if !app.pairedScreens.isEmpty {
                    pairedContent
                } else {
                    unpairedContent
                }
            }
            .navigationTitle("screens")
            .background(Color.appBackground.ignoresSafeArea())
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
    private var targetLabel: String {
        guard let selectedScreen,
              let screen = app.pairedScreens.first(where: { $0.deviceId == selectedScreen })
        else { return app.pairedScreens.count > 1 ? "All screens" : "your screen" }
        return screen.kind.label
    }

    private func send(_ channelId: String) {
        Task {
            let ok: Bool
            if let selectedScreen,
               let screen = app.pairedScreens.first(where: { $0.deviceId == selectedScreen }) {
                ok = await app.push(channelId: channelId, to: screen)
            } else {
                ok = await app.pushToAllScreens(channelId: channelId) > 0
            }
            if ok {
                justPushed = channelId
                try? await Task.sleep(for: .seconds(2))
                if justPushed == channelId { justPushed = nil }
            }
        }
    }

    private var pairedContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                // Screens — one card each, live status while the app is open.
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("your screens")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                        Spacer()
                        Button {
                            showingAddScreen = true
                        } label: {
                            Label("Add", systemImage: "plus")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Color.textPrimary)
                        }
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            if app.pairedScreens.count > 1 {
                                allScreensCard
                            }
                            ForEach(app.pairedScreens) { screen in
                                screenCard(screen)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }

                if let error = app.pairPushError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }

                // Channels as poster cards — same language as the Watch tab.
                if !app.credentials.isEmpty {
                    channelSection(
                        "your channels",
                        items: app.credentials.map { ($0.channelId, $0.label) })
                }
                channelSection(
                    "gallery",
                    items: app.channels.map { ($0.id, $0.displayLabel) })
            }
            .padding(20)
        }
        .refreshable {
            await app.refreshScreenStatuses()
            await app.loadGallery()
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
            // Poll while this tab is on screen so the dots stay honest.
            while !Task.isCancelled {
                await app.refreshScreenStatuses()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private var allScreensCard: some View {
        let selected = selectedScreen == nil
        return Button {
            selectedScreen = nil
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "rectangle.3.group")
                    .font(.title3)
                    .foregroundStyle(Color.textPrimary)
                Spacer(minLength: 0)
                Text("All screens")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                Text("\(app.pairedScreens.count) paired")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
            }
            .padding(14)
            .frame(width: 148, height: 118, alignment: .leading)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(selected ? Color.textPrimary : Color.appBorder.opacity(0.6),
                                  lineWidth: selected ? 2 : 1)
            }
        }
        .buttonStyle(.plain)
    }

    private func screenCard(_ screen: PairedScreen) -> some View {
        let selected = selectedScreen == screen.deviceId
        return Button {
            selectedScreen = selected ? nil : screen.deviceId
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: screen.kind.icon)
                        .font(.title3)
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                    Circle()
                        .fill(screen.hasRegistered ? Color.appSuccess : Color.textTertiary)
                        .frame(width: 8, height: 8)
                }
                Spacer(minLength: 0)
                Text(screen.kind.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                Text(screen.statusText)
                    .font(.caption)
                    .foregroundStyle(screen.hasRegistered ? Color.textSecondary : Color.textTertiary)
                    .lineLimit(1)
            }
            .padding(14)
            .frame(width: 148, height: 118, alignment: .leading)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(selected ? Color.textPrimary : Color.appBorder.opacity(0.6),
                                  lineWidth: selected ? 2 : 1)
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Unpair \(screen.kind.label)", role: .destructive) { app.unpair(screen) }
        }
    }

    /// A shelf of channel poster cards that push on tap.
    private func channelSection(_ title: String, items: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                Text("→ \(targetLabel)")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 16) {
                ForEach(items, id: \.0) { id, label in
                    channelCard(id: id, label: label)
                }
            }
        }
    }

    private func channelCard(id: String, label: String) -> some View {
        let onTarget = app.pairedScreens.contains { $0.channelId == id }
        return Button {
            send(id)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                ZStack {
                    if let spec = app.channels.first(where: { $0.id == id })?.spec {
                        ScenePreviewView(spec: spec, fallbackSeed: id)
                    } else {
                        LinearGradient(colors: [Color.appSurfaceRaised, Color.appBackground],
                                       startPoint: .top, endPoint: .bottom)
                    }
                    if justPushed == id {
                        Color.black.opacity(0.45)
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white)
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .topTrailing) {
                    if onTarget {
                        Text("ON AIR")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.appBackground)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Color.textPrimary, in: Capsule())
                            .padding(6)
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
                }

                Text(label)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
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

import SwiftUI

/// "Send to screens" from a channel page: which screens, what — live or the
/// scene on screen — and whether they keep following.
///
/// Before this the rail's one button pushed the channel, live, to every paired
/// screen; a past scene could not be sent at all, and there was no way to pick
/// a screen. Sync makes the chosen screens follow this device: every channel
/// flip and every step through history lands on them too (`AppState.syncFollow`).
struct CastSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    let channelId: String
    let channelLabel: String
    /// The stored scene on screen, when this page is one of the channel's past
    /// moments; nil on the live page.
    let sceneId: Int?
    let sceneTitle: String?
    /// What happened, for the page's toast.
    let onDone: (String) -> Void

    private enum What: String, CaseIterable { case scene, live }
    @State private var what: What = .scene
    @State private var chosen: Set<String> = []
    @State private var keepInSync = false
    @State private var sending = false

    private var screens: [PairedScreen] { app.pairedScreens }
    private var pinned: Int? { sceneId != nil && what == .scene ? sceneId : nil }
    private var chosenScreens: [PairedScreen] { screens.filter { chosen.contains($0.deviceId) } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if sceneId != nil {
                        Picker("Send", selection: $what) {
                            Text("This scene").tag(What.scene)
                            Text("Live").tag(What.live)
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                    Text(summary)
                        .font(.footnote)
                        .foregroundStyle(Color.textSecondary)
                        .listRowBackground(Color.clear)
                }

                Section("Screens") {
                    ForEach(screens) { screen in
                        Button { toggle(screen) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: screen.kind.icon)
                                    .frame(width: 26)
                                    .foregroundStyle(Color.appPrimary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(screen.kind.label)
                                        .foregroundStyle(Color.textPrimary)
                                    Text(detail(for: screen))
                                        .font(.caption)
                                        .foregroundStyle(Color.textSecondary)
                                }
                                Spacer()
                                Image(systemName: chosen.contains(screen.deviceId) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(chosen.contains(screen.deviceId) ? Color.appPrimary : Color.textTertiary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen.contains(screen.deviceId) ? .isSelected : [])
                    }
                }

                Section {
                    Toggle(isOn: $keepInSync) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Keep in sync")
                            Text("The chosen screens follow you here: every channel you flip to and every scene you step back to.")
                                .font(.caption)
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                    .tint(Color.appPrimary)
                    if keepInSync, chosenScreens.contains(where: { !app.canSync($0) }) {
                        Text("Linux screens can't follow yet — they'll get this one send, not the rest.")
                            .font(.caption)
                            .foregroundStyle(Color.textSecondary)
                    }
                    if app.isSyncing {
                        Button("Stop syncing", role: .destructive) {
                            app.stopSync()
                            onDone("stopped syncing")
                            dismiss()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .navigationTitle("Send to screens")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: send) {
                    Group {
                        if sending { ProgressView() } else { Text(actionTitle).font(.headline) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.appPrimary)
                .disabled(chosen.isEmpty || sending)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
        }
        .onAppear {
            what = sceneId == nil ? .live : .scene
            keepInSync = app.isSyncing
            chosen = Set(app.isSyncing ? app.syncTargets : screens.map(\.deviceId))
        }
    }

    private var summary: String {
        if pinned != nil {
            let title = sceneTitle.map { "“\($0)”" } ?? "this scene"
            return "\(title) from \(channelLabel) — it stays on that scene until you send something else."
        }
        return "\(channelLabel), live — it follows whatever the channel plays."
    }

    private var actionTitle: String {
        let n = chosen.count
        let screensWord = n == 1 ? "1 screen" : "\(n) screens"
        if keepInSync { return app.isSyncing ? "Update sync" : "Sync \(screensWord)" }
        return "Send to \(screensWord)"
    }

    private func detail(for screen: PairedScreen) -> String {
        if let showing = screen.channelId {
            let label = app.channels.first { $0.id == showing }?.displayLabel ?? showing
            return "showing \(label)"
        }
        return "paired"
    }

    private func toggle(_ screen: PairedScreen) {
        if chosen.contains(screen.deviceId) { chosen.remove(screen.deviceId) } else { chosen.insert(screen.deviceId) }
    }

    private func send() {
        let ids = Array(chosen)
        if keepInSync {
            // One send now to everyone chosen (Linux included), then the
            // followers track the feed from here.
            sending = true
            Task {
                let n = await app.push(channelId: channelId, sceneId: pinned, to: ids)
                app.startSync(ids, channelId: channelId, sceneId: pinned)
                sending = false
                onDone(n > 0 ? "syncing \(app.syncTargets.count) screen\(app.syncTargets.count == 1 ? "" : "s")"
                             : app.pairPushError ?? "couldn't reach those screens")
                dismiss()
            }
            return
        }
        if app.isSyncing { app.stopSync() }
        sending = true
        Task {
            let n = await app.push(channelId: channelId, sceneId: pinned, to: ids)
            sending = false
            onDone(n > 0 ? "sent to \(n) screen\(n == 1 ? "" : "s")"
                         : app.pairPushError ?? "couldn't reach those screens")
            dismiss()
        }
    }
}

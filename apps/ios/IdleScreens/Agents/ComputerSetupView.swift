import SwiftUI
import UIKit

/// Connecting a coding agent — Claude Code, Cursor, Codex… — is done on the
/// computer it runs on, so from the phone the useful thing is to send the
/// setup there. One share sends all of it; each harness keeps its exact
/// recipe a tap away.
struct ComputerSetupView: View {
    private let clients = AgentHandoff.clients()
    private var mcp: String { AgentHandoff.mcpURL() }

    var body: some View {
        List {
            Section {
                ShareLink(item: AgentHandoff.setupNote(mcp: mcp)) {
                    SettingsLabel(title: "Send setup to my computer", icon: "square.and.arrow.up", tint: .appPrimary)
                }
            } footer: {
                Text("AirDrop or message yourself the address, the Claude Code command and one-click install links for Cursor and VS Code.")
            }
            .houseRow()

            Section("Harnesses") {
                ForEach(clients) { client in
                    NavigationLink { RecipeView(client: client) } label: {
                        HStack {
                            Label {
                                Text(client.name).foregroundStyle(Color.textPrimary)
                            } icon: {
                                Image(systemName: client.icon).foregroundStyle(Color.appPrimary)
                            }
                            Spacer()
                            if client.installLink != nil {
                                Text("one click")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Color.textSecondary)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(Color.appSurfaceRaised, in: Capsule())
                            }
                        }
                    }
                }
            }
            .houseRow()
        }
        .houseList()
        .navigationTitle("coding agents")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct RecipeView: View {
    let client: AgentHandoff.Client
    @State private var copied = false

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(client.recipe)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Color.textPrimary)
                        .textSelection(.enabled)
                        .padding(.vertical, 4)
                }
            } footer: {
                Text(client.note)
            }
            .houseRow()

            Section {
                Button {
                    UIPasteboard.general.string = client.recipe
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    withAnimation { copied = true }
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                ShareLink(item: client.recipe) { Label("Send to my computer", systemImage: "square.and.arrow.up") }
                if let link = client.installLink {
                    ShareLink(item: link) { Label("Send the install link", systemImage: "link") }
                }
            }
            .houseRow()
        }
        .houseList()
        .navigationTitle(client.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

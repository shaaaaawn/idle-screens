import SwiftUI
import UIKit

/// The MCP tab. Scenes here are made by agents, over MCP — so the tab leads
/// with the one address every agent needs, then gets a scene started from the
/// phone: connect Claude or ChatGPT, brief it, keep the keys to what it makes.
/// Setting up a coding agent happens at a computer, so it is one row away
/// rather than half the page.
struct AgentsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var brief = ""
    @State private var target: AgentHandoff.Target = .newChannel
    @State private var showingChannels = false
    @State private var toast: String?

    private var mcp: String { AgentHandoff.mcpURL() }
    private var prompt: String { AgentHandoff.prompt(brief: brief, target: target) }

    var body: some View {
        NavigationStack {
            List {
                ListColumnTitle(title: "agents")

                Section {
                    MCPHero(mcp: mcp, onCopy: { copy(mcp, "address copied") }) { agent in
                        // Their connector screens take the address by paste,
                        // so it is on the clipboard before you land there.
                        copy(mcp, "address copied — add it as a custom connector")
                        if let connectors = agent.connectors { openURL(connectors) }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                briefSection

                Section {
                    Button { showingChannels = true } label: {
                        HStack {
                            SettingsLabel(title: app.credentials.isEmpty ? "Start a channel" : "Your channels",
                                          icon: "rectangle.stack.fill", tint: .appPrimary,
                                          detail: app.credentials.isEmpty ? nil : "\(app.credentials.count)")
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.textTertiary)
                        }
                    }
                    NavigationLink { ComputerSetupView() } label: {
                        SettingsLabel(title: "Set up a coding agent", icon: "laptopcomputer", tint: .gray)
                    }
                    NavigationLink { MCPExplorerView() } label: {
                        SettingsLabel(title: "Inside the MCP", icon: "server.rack", tint: .teal)
                    }
                } footer: {
                    Text("Claude Code, Cursor, Codex and more — set up once on the computer they run on.")
                }
                .houseRow()
            }
            .houseList()
            .scrollDismissesKeyboard(.interactively)
            .modifier(ColumnTitle(title: "agents"))
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Color.textPrimary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .glassCapsule(shape: Capsule())
                        .padding(.bottom, 20)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(.easeInOut(duration: 0.25), value: toast)
        }
        .sheet(isPresented: $showingChannels) { MyChannelsView() }
    }

    // MARK: Brief an agent

    private var briefSection: some View {
        Section {
            TextField("A slow aurora over a frozen lake…", text: $brief, axis: .vertical)
                .lineLimit(2...5)
                .foregroundStyle(Color.textPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(AgentHandoff.starterBriefs, id: \.self) { idea in
                        Button { withAnimation(.snappy) { brief = idea } } label: {
                            Text(idea)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 7)
                                .foregroundStyle(brief == idea ? Color.appPrimary : Color.textSecondary)
                                .background(brief == idea ? Color.appPrimary.opacity(0.14) : Color.appSurfaceRaised,
                                            in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))

            Picker("Make it on", selection: $target) {
                Text("A new channel").tag(AgentHandoff.Target.newChannel)
                ForEach(app.credentials) { credential in
                    Text(credential.label)
                        .tag(AgentHandoff.Target.channel(id: credential.channelId, label: credential.label))
                }
            }
            .foregroundStyle(Color.textPrimary)

            HStack(spacing: 10) {
                ForEach(AgentHandoff.promptApps) { agent in
                    let lead = agent.id == AgentHandoff.promptApps.first?.id
                    Button {
                        if let link = agent.link(for: prompt) { openURL(link) }
                    } label: {
                        Label {
                            Text(agent.name)
                        } icon: {
                            // The product's own mark, as a template: it takes
                            // the button's text colour in either style.
                            Image(agent.markAsset)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 16, height: 16)
                                .accessibilityHidden(true)
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(lead ? Color.appBackground : Color.textPrimary)
                        .background(lead ? Color.textPrimary : Color.appSurfaceRaised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open in \(agent.name)")
                }
                Menu {
                    Button { copy(prompt, "prompt copied — paste it into any agent") } label: {
                        Label("Copy prompt", systemImage: "doc.on.doc")
                    }
                    ShareLink(item: prompt) { Label("Send to…", systemImage: "square.and.arrow.up") }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 44, height: 44)
                        .foregroundStyle(Color.textPrimary)
                        .background(Color.appSurfaceRaised, in: Circle())
                }
                .accessibilityLabel("More ways to send the prompt")
            }
            .listRowSeparator(.hidden, edges: .top)
        } header: {
            Text("Brief an agent")
        } footer: {
            Text("Opens as a ready-to-run prompt. It never carries a key — the agent asks when it needs one.")
        }
        .houseRow()
    }

    private func copy(_ text: String, _ message: String) {
        UIPasteboard.general.string = text
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            if toast == message { toast = nil }
        }
    }
}

/// The address every agent needs, as the page's one big thing. Dark in either
/// appearance: it is a lit card, like the screens it feeds.
private struct MCPHero: View {
    let mcp: String
    let onCopy: () -> Void
    let onConnect: (AgentHandoff.PromptApp) -> Void
    @Environment(\.deviceScale) private var scale

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("MCP server", systemImage: "sparkles")
                    .font(.caption.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(Color(hex: "C9C1FF"))
                Spacer()
                ShareLink(item: mcp) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 32, height: 32)
                        .foregroundStyle(.white.opacity(0.85))
                }
                .accessibilityLabel("Share the address")
            }

            Text("Any agent can paint your screens.")
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: onCopy) {
                HStack(spacing: 10) {
                    Text(mcp.replacingOccurrences(of: "https://", with: ""))
                        .font(.system(.callout, design: .monospaced).weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Spacer(minLength: 4)
                    Image(systemName: "doc.on.doc")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Copy \(mcp)")

            HStack(spacing: 10) {
                ForEach(AgentHandoff.promptApps) { agent in
                    Button { onConnect(agent) } label: {
                        Label {
                            Text("Add to \(agent.name)")
                        } icon: {
                            Image(agent.markAsset)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 15, height: 15)
                                .accessibilityHidden(true)
                        }
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .foregroundStyle(Color(hex: "0A0A0F"))
                        .background(.white, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(20 * scale)
        .background {
            ZStack {
                LinearGradient(colors: [Color(hex: "241C5C"), Color(hex: "0E0B24")],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(colors: [Color(hex: "8B7CFF").opacity(0.55), .clear],
                               center: .topTrailing, startRadius: 0, endRadius: 260 * scale)
                RadialGradient(colors: [Color(hex: "5EEAD4").opacity(0.28), .clear],
                               center: .bottomLeading, startRadius: 0, endRadius: 220 * scale)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        }
        .environment(\.colorScheme, .dark)
    }
}

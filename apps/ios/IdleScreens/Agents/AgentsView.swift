import SwiftUI
import UIKit

/// The MCP tab. Scenes here are made by agents, over MCP, from whatever
/// harness you already use — so instead of pretending to be an editor, this
/// tab does the three things that actually get a scene made: brief an agent,
/// connect a harness, and keep the keys to what they build.
struct AgentsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var brief = ""
    @State private var target: AgentHandoff.Target = .newChannel
    @State private var openClient: String?
    @State private var showingChannels = false
    @State private var toast: String?

    private var mcp: String { AgentHandoff.mcpURL() }
    private var prompt: String { AgentHandoff.prompt(brief: brief, target: target) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    header
                    briefSection
                    connectSection
                    channelsSection
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.appBackground.ignoresSafeArea())
            .navigationTitle("agents")
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

    // MARK: Header — the one address everything else hangs off

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Agents make the scenes.")
                .font(.title2.weight(.bold))
                .foregroundStyle(Color.textPrimary)
            Text("Every channel is authored over MCP — one address, any agent. Point yours at it and ask for what you want on the wall.")
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
            HStack(spacing: 10) {
                Text(mcp)
                    .font(.system(.footnote, design: .monospaced).weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Button { copy(mcp, "address copied") } label: {
                    Image(systemName: "doc.on.doc").frame(width: 34, height: 34).contentShape(Rectangle())
                }
                ShareLink(item: mcp) {
                    Image(systemName: "square.and.arrow.up").frame(width: 34, height: 34).contentShape(Rectangle())
                }
            }
            .foregroundStyle(Color.appPrimary)
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 5)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }
        }
    }

    // MARK: Brief an agent

    private var briefSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("brief an agent", "Say what you want. It opens in your agent as a ready-to-run prompt.")

            TextField("a slow aurora over a frozen lake…", text: $brief, axis: .vertical)
                .lineLimit(2...5)
                .padding(13)
                .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }
                .foregroundStyle(Color.textPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(AgentHandoff.starterBriefs, id: \.self) { idea in
                        Button { brief = idea } label: {
                            Text(idea)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 7)
                                .foregroundStyle(Color.textSecondary)
                                .background(Color.appSurface, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Menu {
                Picker("Where", selection: $target) {
                    Label("A new channel", systemImage: "plus").tag(AgentHandoff.Target.newChannel)
                    ForEach(app.credentials) { credential in
                        Text(credential.label)
                            .tag(AgentHandoff.Target.channel(id: credential.channelId, label: credential.label))
                    }
                }
            } label: {
                HStack {
                    Text("on").foregroundStyle(Color.textSecondary)
                    Text(targetLabel).foregroundStyle(Color.textPrimary).fontWeight(.medium)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(Color.textTertiary)
                }
                .font(.subheadline)
                .contentShape(Rectangle())
            }

            HStack(spacing: 10) {
                ForEach(AgentHandoff.promptApps) { agent in
                    Button {
                        if let link = agent.link(for: prompt) { openURL(link) }
                    } label: {
                        Text("Open in \(agent.name)")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .foregroundStyle(agent.id == "claude" ? Color.appBackground : Color.textPrimary)
                            .background(agent.id == "claude" ? Color.textPrimary : Color.appSurface, in: Capsule())
                            .overlay { Capsule().strokeBorder(Color.appBorder.opacity(agent.id == "claude" ? 0 : 0.6), lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 18) {
                Button { copy(prompt, "prompt copied — paste it into any agent") } label: {
                    Label("Copy prompt", systemImage: "doc.on.doc")
                }
                ShareLink(item: prompt) { Label("Send to…", systemImage: "square.and.arrow.up") }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.appPrimary)

            Text("The prompt never includes a key. For a channel you own, the agent will ask — paste the key yourself if you trust where you're pasting it.")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
        }
    }

    private var targetLabel: String {
        switch target {
        case .newChannel: "a new channel"
        case .channel(_, let label): label
        }
    }

    // MARK: Connect a harness

    private var connectSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("connect your harness", "One-time setup on the computer where your agent runs. Send the recipe to yourself, or AirDrop an install link.")
            VStack(spacing: 0) {
                let clients = AgentHandoff.clients()
                ForEach(clients) { client in
                    clientRow(client)
                    if client.id != clients.last?.id {
                        Divider().overlay(Color.appBorder.opacity(0.5))
                    }
                }
            }
            .padding(.horizontal, 16)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }

            HStack(spacing: 16) {
                ForEach(AgentHandoff.promptApps) { agent in
                    if let connectors = agent.connectors {
                        Link(destination: connectors) {
                            Label("\(agent.name) connectors", systemImage: "arrow.up.right")
                        }
                    }
                }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.appPrimary)
            Text("In Claude or ChatGPT, add a custom connector with the address above.")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
        }
    }

    private func clientRow(_ client: AgentHandoff.Client) -> some View {
        let open = openClient == client.id
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.spring(duration: 0.3, bounce: 0.1)) { openClient = open ? nil : client.id }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: client.icon)
                        .foregroundStyle(Color.appPrimary)
                        .frame(width: 26)
                    Text(client.name).foregroundStyle(Color.textPrimary)
                    Spacer()
                    if client.installLink != nil {
                        Text("install link")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.textSecondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Color.appBackground, in: Capsule())
                    }
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.vertical, 13)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                VStack(alignment: .leading, spacing: 10) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(client.recipe)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Color.textPrimary)
                            .textSelection(.enabled)
                            .padding(12)
                    }
                    .background(Color.appBackground, in: RoundedRectangle(cornerRadius: 10))
                    Text(client.note)
                        .font(.caption)
                        .foregroundStyle(Color.textSecondary)
                    HStack(spacing: 18) {
                        Button { copy(client.recipe, "\(client.name) recipe copied") } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        ShareLink(item: client.recipe) { Label("Send", systemImage: "square.and.arrow.up") }
                        if let link = client.installLink {
                            ShareLink(item: link) { Label("Install link", systemImage: "link") }
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.appPrimary)
                }
                .padding(.bottom, 14)
                .transition(.opacity)
            }
        }
    }

    // MARK: Your channels

    private var channelsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("your channels", "What your agents have built, and the keys to steer it. Start one here and hand it to an agent.")
            Button { showingChannels = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "rectangle.stack")
                        .foregroundStyle(Color.appPrimary)
                        .frame(width: 26)
                    Text(app.credentials.isEmpty ? "Start a channel" : "Open your channels")
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                    if !app.credentials.isEmpty {
                        Text("\(app.credentials.count)").foregroundStyle(Color.textSecondary)
                    }
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                }
                .padding(16)
                .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
                .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1) }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Bits

    private func sectionTitle(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(Color.textSecondary)
        }
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

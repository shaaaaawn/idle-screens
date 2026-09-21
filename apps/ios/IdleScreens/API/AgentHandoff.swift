import Foundation

/// Handing the making of scenes to an agent.
///
/// The app steers; it does not author. Authoring happens over MCP, from
/// whatever harness the person already uses — so this is the app's honest
/// answer to "how do I create?": connect an agent, and brief it.
///
/// Recipes mirror the website's connect block (`MCP_CLIENTS` in
/// `idle-server/site/src/features/gallery/Gallery.tsx`). Every harness spells
/// its config differently; the differences are the whole point of the table.
enum AgentHandoff {
    static func mcpURL(baseURL: String = Config.baseURL) -> String {
        baseURL.hasSuffix("/") ? baseURL + "mcp" : baseURL + "/mcp"
    }

    struct Client: Identifiable, Equatable {
        let id: String
        let name: String
        let icon: String
        /// What to paste, exactly.
        let recipe: String
        /// Where it goes.
        let note: String
        /// A link that installs the server in one step, when the harness has one.
        let installLink: URL?
    }

    static func clients(mcp: String = mcpURL()) -> [Client] {
        [
            Client(id: "claude-code", name: "Claude Code", icon: "terminal",
                   recipe: "claude mcp add --transport http --scope user idle-screens \(mcp)",
                   note: "No config file — run it, then /mcp to check it connected.",
                   installLink: nil),
            Client(id: "cursor", name: "Cursor", icon: "cursorarrow.rays",
                   recipe: "{\n  \"mcpServers\": {\n    \"idle-screens\": {\n      \"url\": \"\(mcp)\"\n    }\n  }\n}",
                   note: ".cursor/mcp.json — or use the install link on the computer running Cursor.",
                   installLink: cursorInstallLink(mcp: mcp)),
            Client(id: "vscode", name: "VS Code · GitHub Copilot", icon: "chevron.left.forwardslash.chevron.right",
                   recipe: "{\n  \"servers\": {\n    \"idle-screens\": {\n      \"type\": \"http\",\n      \"url\": \"\(mcp)\"\n    }\n  }\n}",
                   note: ".vscode/mcp.json — note `servers`, not `mcpServers`.",
                   installLink: vscodeInstallLink(mcp: mcp)),
            Client(id: "codex", name: "Codex", icon: "apple.terminal",
                   recipe: "[mcp_servers.idle-screens]\nurl = \"\(mcp)\"",
                   note: "~/.codex/config.toml — TOML, not JSON.",
                   installLink: nil),
            Client(id: "windsurf", name: "Windsurf", icon: "wind",
                   recipe: "{\n  \"mcpServers\": {\n    \"idle-screens\": {\n      \"serverUrl\": \"\(mcp)\"\n    }\n  }\n}",
                   note: "~/.codeium/windsurf/mcp_config.json — `serverUrl`, not `url`.",
                   installLink: nil),
            Client(id: "zed", name: "Zed", icon: "bolt",
                   recipe: "{\n  \"context_servers\": {\n    \"idle-screens\": {\n      \"source\": \"custom\",\n      \"url\": \"\(mcp)\"\n    }\n  }\n}",
                   note: "Zed settings.json — MCP servers are `context_servers` here.",
                   installLink: nil),
            Client(id: "cline", name: "Cline", icon: "curlybraces",
                   recipe: "{\n  \"mcpServers\": {\n    \"idle-screens\": {\n      \"type\": \"streamableHttp\",\n      \"url\": \"\(mcp)\"\n    }\n  }\n}",
                   note: "cline_mcp_settings.json, via the MCP Servers pane.",
                   installLink: nil),
            Client(id: "warp", name: "Warp", icon: "rectangle.and.text.magnifyingglass",
                   recipe: "{\n  \"idle-screens\": {\n    \"url\": \"\(mcp)\"\n  }\n}",
                   note: "Warp → Settings → AI → MCP servers → add as JSON.",
                   installLink: nil),
        ]
    }

    /// Cursor's documented install link: a name plus base64 of the server's
    /// config object. https form, so it survives being AirDropped to a Mac.
    static func cursorInstallLink(mcp: String) -> URL? {
        guard let config = try? JSONSerialization.data(withJSONObject: ["url": mcp], options: [.sortedKeys])
        else { return nil }
        var parts = URLComponents(string: "https://cursor.com/en/install-mcp")
        parts?.queryItems = [URLQueryItem(name: "name", value: "idle-screens"),
                             URLQueryItem(name: "config", value: config.base64EncodedString())]
        return parts?.url
    }

    /// VS Code's documented install redirect: a name plus the JSON config.
    static func vscodeInstallLink(mcp: String) -> URL? {
        guard let config = try? JSONSerialization.data(
            withJSONObject: ["type": "http", "url": mcp], options: [.sortedKeys]),
              let json = String(data: config, encoding: .utf8) else { return nil }
        var parts = URLComponents(string: "https://vscode.dev/redirect/mcp/install")
        parts?.queryItems = [URLQueryItem(name: "name", value: "idle-screens"),
                             URLQueryItem(name: "config", value: json)]
        return parts?.url
    }

    // MARK: Briefs

    /// Where the agent should work.
    enum Target: Hashable {
        case newChannel
        case channel(id: String, label: String)
    }

    static let starterBriefs = [
        "a slow aurora over a frozen lake, for a bedroom at night",
        "rain on a neon street, seen from a café window",
        "a koi pond from above, lily pads drifting",
        "a quiet dashboard of the weather outside, in one glance",
        "the inside of a lava lamp, warm and slow",
    ]

    /// The prompt handed to an agent. It never carries a key: a prompt lands in
    /// a third party's chat history, and a key in it would be a key leaked. The
    /// agent is told to ask, and the person pastes it themselves if they choose.
    static func prompt(brief: String, target: Target, mcp: String = mcpURL()) -> String {
        let idea = brief.trimmingCharacters(in: .whitespacesAndNewlines)
        let subject = idea.isEmpty ? "something ambient and unhurried that suits a screen left on all day" : idea
        let place: String
        switch target {
        case .newChannel:
            place = "Create a new channel for it with createChannel and keep the token it returns safe — give it to me at the end along with the channel's link."
        case .channel(let id, let label):
            place = "Work on my existing channel \"\(label)\" (id: \(id)). It is claimed, so ask me for its key before you publish — do not guess one."
        }
        return """
        Use the idle-screens MCP server at \(mcp). If it isn't connected yet, tell me how to add it to this app, then continue.

        Make an ambient scene: \(subject).

        \(place)

        Read screen://schema and screen://playbook first. Draft with previewScene and judge it from the perception numbers before you publish. Aim for depth, atmosphere and restraint — layers at different speeds, soft light, negative space. Pass agent, model, harness and intent on every call so the channel's history says who made this and why.
        """
    }

    /// Phone agents that open on a prefilled prompt from a plain https link.
    struct PromptApp: Identifiable, Equatable {
        let id: String
        let name: String
        let base: String
        /// Where that app manages MCP connectors, for the "not connected" case.
        let connectors: URL?

        func link(for prompt: String) -> URL? {
            var parts = URLComponents(string: base)
            parts?.queryItems = [URLQueryItem(name: "q", value: prompt)]
            return parts?.url
        }
    }

    static let promptApps = [
        PromptApp(id: "claude", name: "Claude", base: "https://claude.ai/new",
                  connectors: URL(string: "https://claude.ai/settings/connectors")),
        PromptApp(id: "chatgpt", name: "ChatGPT", base: "https://chatgpt.com/",
                  connectors: URL(string: "https://chatgpt.com/#settings/Connectors")),
    ]
}

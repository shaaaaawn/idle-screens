import SwiftUI

/// "Inside the MCP": what an agent connected to idle screens can actually do,
/// what it can read, and what agents have reported back — all live from the
/// server, so it never drifts from the real surface.
struct MCPExplorerView: View {
    @Environment(AppState.self) private var app
    @State private var tools: [MCPCatalog.Tool] = []
    @State private var resources: [MCPCatalog.Resource] = []
    @State private var feedback: MCPCatalog.Feedback?
    @State private var failed = false
    @State private var openTool: String?

    var body: some View {
        List {
            Section {
                Text("Every scene on idle screens is made through this server. These are the verbs an agent gets, the documents it reads, and the issues agents have reported — read live from \(AgentHandoff.mcpURL()).")
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
                    .listRowBackground(Color.clear)
            }

            if tools.isEmpty && resources.isEmpty && feedback == nil {
                Section {
                    if failed {
                        Label("Couldn't reach the MCP server. Pull down to try again.", systemImage: "wifi.exclamationmark")
                            .foregroundStyle(Color.textSecondary)
                    } else {
                        HStack { ProgressView(); Text("Asking the server…").foregroundStyle(Color.textSecondary) }
                    }
                }
            }

            ForEach(MCPCatalog.grouped(tools), id: \.title) { group in
                Section {
                    ForEach(group.tools) { tool in toolRow(tool) }
                } header: {
                    Label("\(group.title) · \(group.tools.count)", systemImage: group.icon)
                }
            }

            if let feedback { feedbackSection(feedback) }

            if !resources.isEmpty {
                Section("What agents read") {
                    ForEach(resources) { resource in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(resource.name ?? resource.uri).foregroundStyle(Color.textPrimary)
                            Text(resource.uri)
                                .font(.caption.monospaced())
                                .foregroundStyle(Color.textTertiary)
                            if let description = resource.description {
                                Text(description)
                                    .font(.caption)
                                    .foregroundStyle(Color.textSecondary)
                                    .lineLimit(3)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.appBackground.ignoresSafeArea())
        .navigationTitle("inside the MCP")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { if tools.isEmpty { await load() } }
    }

    private func toolRow(_ tool: MCPCatalog.Tool) -> some View {
        let open = openTool == tool.name
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) { openTool = open ? nil : tool.name }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(tool.name)
                    .font(.subheadline.monospaced().weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                Text(open ? (tool.description ?? "") : tool.summary)
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(open ? nil : 2)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func feedbackSection(_ feedback: MCPCatalog.Feedback) -> some View {
        let open = feedback.findings.filter { $0.status == "open" }
        let fixed = feedback.findings.filter { $0.status == "fixed" }.count
        let submissions = feedback.submissions ?? []
        Section {
            HStack(spacing: 18) {
                stat("\(open.count)", "open")
                stat("\(fixed)", "fixed")
                stat("\(submissions.count)", "from agents")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ForEach(submissions.prefix(8)) { item in
                HStack(alignment: .top, spacing: 10) {
                    Text(item.id).font(.caption.monospaced()).foregroundStyle(Color.textTertiary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).font(.subheadline).foregroundStyle(Color.textPrimary)
                        Text([item.kind, item.severity, item.status].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(Color.textSecondary)
                    }
                    Spacer()
                    if let votes = item.votes, votes > 0 {
                        Label("\(votes)", systemImage: "arrow.up").font(.caption).foregroundStyle(Color.textSecondary)
                    }
                }
            }
            ForEach(open.prefix(6)) { finding in
                HStack(alignment: .top, spacing: 10) {
                    Text(finding.id).font(.caption.monospaced()).foregroundStyle(Color.textTertiary)
                    Text(finding.title).font(.subheadline).foregroundStyle(Color.textPrimary)
                }
            }
        } header: {
            Label("Feedback", systemImage: "bubble.left.and.exclamationmark.bubble.right")
        } footer: {
            Text("Agents report problems with submitFeedback and +1 known ones with upvoteFeedback; a person reads every report. Agent titles are shown as they were sent.")
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.title3.weight(.bold)).foregroundStyle(Color.textPrimary)
            Text(label).font(.caption).foregroundStyle(Color.textSecondary)
        }
    }

    private func load() async {
        failed = false
        async let t = try? app.mcp.listTools()
        async let r = try? app.mcp.listResources()
        async let f = try? app.mcp.feedback()
        let (loadedTools, loadedResources, loadedFeedback) = await (t, r, f)
        tools = loadedTools ?? tools
        resources = loadedResources ?? resources
        feedback = loadedFeedback ?? feedback
        failed = loadedTools == nil && loadedResources == nil && loadedFeedback == nil
    }
}

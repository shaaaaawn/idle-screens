import XCTest
@testable import IdleScreens

final class AgentHandoffTests: XCTestCase {
    private let mcp = "https://idlescreens.com/mcp"

    func testMCPURLComesFromTheServerBase() {
        XCTAssertEqual(AgentHandoff.mcpURL(baseURL: "https://idlescreens.com"), mcp)
        XCTAssertEqual(AgentHandoff.mcpURL(baseURL: "http://localhost:8787/"), "http://localhost:8787/mcp")
    }

    /// Each harness spells its config differently; these are the spellings the
    /// website publishes, and a "tidy-up" that unifies them breaks real installs.
    func testRecipesKeepEachHarnessesOwnSpelling() throws {
        let byId = Dictionary(uniqueKeysWithValues: AgentHandoff.clients(mcp: mcp).map { ($0.id, $0) })
        XCTAssertEqual(byId["claude-code"]?.recipe,
                       "claude mcp add --transport http --scope user idle-screens https://idlescreens.com/mcp")
        XCTAssertTrue(try XCTUnwrap(byId["vscode"]).recipe.contains("\"servers\""))
        XCTAssertFalse(try XCTUnwrap(byId["vscode"]).recipe.contains("mcpServers"))
        XCTAssertTrue(try XCTUnwrap(byId["windsurf"]).recipe.contains("\"serverUrl\""))
        XCTAssertTrue(try XCTUnwrap(byId["zed"]).recipe.contains("context_servers"))
        XCTAssertTrue(try XCTUnwrap(byId["codex"]).recipe.hasPrefix("[mcp_servers.idle-screens]"))
        XCTAssertEqual(Set(byId.keys).count, AgentHandoff.clients(mcp: mcp).count)
    }

    func testCursorInstallLinkCarriesBase64Config() throws {
        let url = try XCTUnwrap(AgentHandoff.cursorInstallLink(mcp: mcp))
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(url.host, "cursor.com")
        XCTAssertEqual(items.first { $0.name == "name" }?.value, "idle-screens")
        let config = try XCTUnwrap(items.first { $0.name == "config" }?.value)
        let decoded = try XCTUnwrap(Data(base64Encoded: config))
        XCTAssertEqual(try JSONSerialization.jsonObject(with: decoded) as? [String: String], ["url": mcp])
    }

    func testVSCodeInstallLinkCarriesJSONConfig() throws {
        let url = try XCTUnwrap(AgentHandoff.vscodeInstallLink(mcp: mcp))
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let config = try XCTUnwrap(items.first { $0.name == "config" }?.value)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(config.utf8)) as? [String: String],
                       ["type": "http", "url": mcp])
    }

    func testPromptNamesTheServerTheBriefAndTheTarget() {
        let fresh = AgentHandoff.prompt(brief: "  koi pond  ", target: .newChannel, mcp: mcp)
        XCTAssertTrue(fresh.contains(mcp))
        XCTAssertTrue(fresh.contains("Make an ambient scene: koi pond."))
        XCTAssertTrue(fresh.contains("createChannel"))

        let mine = AgentHandoff.prompt(brief: "", target: .channel(id: "living-room", label: "Living Room"), mcp: mcp)
        XCTAssertTrue(mine.contains("id: living-room"))
        XCTAssertTrue(mine.contains("ask me for its key"))
        XCTAssertTrue(mine.contains("ambient and unhurried"))
    }

    /// A prompt ends up in someone else's chat history. It must never hold a key.
    func testPromptNeverCarriesAKey() {
        let prompt = AgentHandoff.prompt(brief: "x", target: .channel(id: "c", label: "C"), mcp: mcp)
        XCTAssertNil(prompt.range(of: #"isk_[A-Za-z0-9_-]+"#, options: .regularExpression))
    }

    func testPromptAppLinksPrefillTheWholePrompt() throws {
        let prompt = "line one\nline two & more?"
        for app in AgentHandoff.promptApps {
            let url = try XCTUnwrap(app.link(for: prompt))
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value
            XCTAssertEqual(q, prompt, app.name)
            XCTAssertEqual(url.scheme, "https")
        }
    }
}

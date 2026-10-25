import XCTest
@testable import IdleScreens

/// The app's side of idle-server PR #250's MCP contract: every write carries
/// `intent` + `harness`, a `confirmation_required` answer is put to the
/// person and repeated with its token (or not at all), errors come from
/// `structuredContent.error`, and the tool names are the ones the server
/// actually lists (`sleepChannel`, not `sleep`).
final class MCPContractTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!

    // MARK: Helpers

    /// A tools/call reply with optional structuredContent (raw JSON).
    private static func reply(text: String, isError: Bool = false, structured: String? = nil) -> Data {
        let escaped = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let sc = structured.map { #","structuredContent":\#($0)"# } ?? ""
        return Data(#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"\#(escaped)"}],"isError":\#(isError)\#(sc)}}"#.utf8)
    }

    private static let confirmReply = reply(
        text: #"{"error":"This pauses every screen on demo: 2 screens are watching it right now. Nothing has happened yet."}"#,
        isError: true,
        structured: #"{"error":{"code":"confirmation_required","message":"This pauses every screen on demo: 2 screens are watching it right now. Nothing has happened yet.","retryable":true,"hint":"Show your human this message.","requestState":"cfm1.123.abc","elicitation":{"mode":"form"}}}"#)

    private func args(_ request: URLRequest) throws -> [String: Any] {
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
        let params = try XCTUnwrap(body?["params"] as? [String: Any])
        return try XCTUnwrap(params["arguments"] as? [String: Any])
    }

    private func toolName(_ request: URLRequest) throws -> String? {
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
        return (body?["params"] as? [String: Any])?["name"] as? String
    }

    private let identity = MCPClientIdentity(harness: "idlescreens-ios", surface: "iPhone",
                                             userAgent: "IdleScreens-iOS/1.0 (build 7; idlescreens-ios)")

    private func client(_ transport: MockTransport, confirmer: MCPConfirmer? = nil) -> MCPClient {
        MCPClient(baseURL: baseURL, transport: transport, identity: identity, confirmer: confirmer)
    }

    /// Counts confirmer calls across the actor boundary.
    private final class Asked: @unchecked Sendable {
        var requests: [MCPConfirmationRequest] = []
    }

    // MARK: Request builder

    func testEveryAppWriteCarriesIntentAndHarnessAndNoAgent() async throws {
        let transport = MockTransport()
        transport.handler = { _ in
            (Self.reply(text: #"{"ok":true,"channelId":"c","token":"isk_x","id":"k1"}"#), 200)
        }
        let mcp = client(transport)
        _ = try await mcp.createChannel(label: "den")
        _ = try await mcp.remixChannel(sourceChannelId: "lobby")
        try await mcp.publishScene(channelId: "c", token: "isk_x", saverId: "warp", seed: 1)
        try await mcp.publishSpec(channelId: "c", token: "isk_x", spec: .object([:]), seed: 1)
        try await mcp.setSeed(channelId: "c", token: "isk_x", seed: 2)
        try await mcp.sleepChannel(channelId: "c", token: "isk_x")
        try await mcp.wakeChannel(channelId: "c", token: "isk_x")
        try await mcp.recallScene(channelId: "c", token: "isk_x", sceneId: 4)
        try await mcp.recallScene(channelId: "c", token: "isk_x", presetName: "dusk")
        try await mcp.savePreset(channelId: "c", token: "isk_x", name: "dusk")
        try await mcp.showOverlay(channelId: "c", token: "isk_x", text: "hi")
        _ = try await mcp.createToken(channelId: "c", token: "isk_x", role: .editor, label: "kitchen")
        try await mcp.revokeToken(channelId: "c", token: "isk_x", id: "k1")

        XCTAssertEqual(transport.requests.count, 13)
        for request in transport.requests {
            let a = try args(request)
            let name = try toolName(request) ?? "?"
            let intent = a["intent"] as? String ?? ""
            XCTAssertFalse(intent.trimmingCharacters(in: .whitespaces).isEmpty, "\(name) sent no intent")
            XCTAssertEqual(a["harness"] as? String, "idlescreens-ios", name)
            XCTAssertNil(a["agent"], "\(name): no AI acts here, so no agent (mirrors the web UI)")
            XCTAssertNil(a["confirm"], name)
            XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), identity.userAgent, name)
        }
        let intents = try transport.requests.map { try args($0)["intent"] as? String }
        XCTAssertEqual(intents[5], "user paused the channel from the iPhone remote")
    }

    func testTheRenamedToolsAreTheServerNames() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Self.reply(text: #"{"ok":true}"#), 200) }
        let mcp = client(transport)
        try await mcp.sleepChannel(channelId: "c", token: "t")
        try await mcp.wakeChannel(channelId: "c", token: "t")
        try await mcp.recallScene(channelId: "c", token: "t", sceneId: 3)
        try await mcp.recallScene(channelId: "c", token: "t", presetName: "p")
        try await mcp.showOverlay(channelId: "c", token: "t", text: "x", tag: "vj", ttl: 4000)
        let names = try transport.requests.map { try toolName($0) }
        // The pre-rename names (sleep, wake, recall, overlay) answer unknown_tool.
        XCTAssertEqual(names, ["sleepChannel", "wakeChannel", "recallScene", "recallScene", "showOverlay"])
        XCTAssertEqual(try args(transport.requests[2])["sceneId"] as? Int, 3)
        XCTAssertEqual(try args(transport.requests[3])["name"] as? String, "p")
        let overlay = try args(transport.requests[4])
        XCTAssertEqual(overlay["text"] as? String, "x")
        XCTAssertEqual(overlay["tag"] as? String, "vj")
        XCTAssertEqual(overlay["ttl"] as? Int, 4000)
    }

    func testReadsAreNotAttributed() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Self.reply(text: #"{"access":"public","tokens":[]}"#), 200) }
        _ = try await client(transport).listTokens(channelId: "c", token: "t")
        let a = try args(XCTUnwrap(transport.requests.first))
        XCTAssertNil(a["intent"])
        XCTAssertNil(a["harness"])
    }

    func testCallerIntentAndHarnessWinAndBlankIntentGetsADefault() {
        let mcp = MCPClient(baseURL: baseURL, identity: identity)
        let kept = mcp.attributed("publishScene", ["harness": .string("idlescreens-web")], intent: "mine")
        XCTAssertEqual(kept["harness"], .string("idlescreens-web"))
        XCTAssertEqual(kept["intent"], .string("mine"))
        let blank = mcp.attributed("setParam", ["intent": .string("   ")], intent: "")
        XCTAssertEqual(blank["intent"], .string("setParam from the Idle Screens iPhone app"))
        XCTAssertEqual(blank["harness"], .string("idlescreens-ios"))
        // Unknown tools are treated as writes: the safe direction.
        XCTAssertTrue(MCPClient.isMutating("someNewTool"))
        XCTAssertFalse(MCPClient.isMutating("previewScene"))
    }

    func testUserAgentAvoidsTheShippedBuildCompatibilityPath() {
        // idle-server's firstPartyApp() matches ^IdleScreens(TV)?/<build> CFNetwork/
        // and its older heuristic substring-matches "pi" to the pi harness.
        let ua = MCPClientIdentity.platformDefault.userAgent
        XCTAssertNil(ua.range(of: #"^IdleScreens(TV)?/\S+ CFNetwork/"#, options: .regularExpression))
        XCTAssertFalse(ua.lowercased().contains("pi"), ua)
        XCTAssertTrue(ua.hasPrefix("IdleScreens-iOS/"), ua)
        XCTAssertEqual(MCPClientIdentity.platformDefault.harness, "idlescreens-ios")
    }

    // MARK: Confirmation

    func testConfirmationIsAskedThenRetriedWithTheToken() async throws {
        let transport = MockTransport()
        transport.handler = { request in
            let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
            let a = (body?["params"] as? [String: Any])?["arguments"] as? [String: Any]
            return a?["confirm"] == nil ? (Self.confirmReply, 200) : (Self.reply(text: #"{"ok":true}"#), 200)
        }
        let asked = Asked()
        let mcp = client(transport) { request in asked.requests.append(request); return true }

        try await mcp.sleepChannel(channelId: "demo", token: "isk_x")

        XCTAssertEqual(asked.requests, [MCPConfirmationRequest(
            tool: "sleepChannel",
            message: "This pauses every screen on demo: 2 screens are watching it right now. Nothing has happened yet.")])
        XCTAssertEqual(transport.requests.count, 2)
        let first = try args(transport.requests[0])
        let retry = try args(transport.requests[1])
        XCTAssertEqual(retry["confirm"] as? String, "cfm1.123.abc")
        // The token is bound to the call's arguments: the retry is the same call.
        var same = retry
        same.removeValue(forKey: "confirm")
        XCTAssertEqual(NSDictionary(dictionary: same), NSDictionary(dictionary: first))
        XCTAssertEqual(try toolName(transport.requests[1]), "sleepChannel")
    }

    func testCancelSendsNothingMore() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Self.confirmReply, 200) }
        let mcp = client(transport) { _ in false }
        do {
            try await mcp.revokeToken(channelId: "demo", token: "isk_x", id: "k1")
            XCTFail("expected cancellation")
        } catch {
            XCTAssertEqual(error as? MCPError, .cancelled(tool: "revokeToken"))
            XCTAssertTrue(error.isMCPCancellation)
        }
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testWithoutAConfirmerTheQuestionIsTheErrorNotASilentNoOp() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Self.confirmReply, 200) }
        do {
            try await client(transport).sleepChannel(channelId: "demo", token: "isk_x")
            XCTFail("expected an error")
        } catch let error as MCPError {
            XCTAssertEqual(error.code, "confirmation_required")
            XCTAssertTrue(error.displayText.contains("2 screens are watching"))
        }
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testConfirmPromptLabelsNameTheAction() {
        XCTAssertEqual(MCPConfirmPrompt.labels(for: "sleepChannel").action, "Pause")
        XCTAssertEqual(MCPConfirmPrompt.labels(for: "revokeToken").action, "Revoke")
        XCTAssertEqual(MCPConfirmPrompt.labels(for: "anythingElse").action, "Continue")
    }

    // MARK: Errors

    func testErrorEnvelopeIsParsed() async throws {
        let transport = MockTransport()
        transport.handler = { _ in
            (Self.reply(
                text: #"{"error":"Rate limit: at most 30 changes per minute."}"#, isError: true,
                structured: #"{"error":{"code":"rate_limited","message":"Rate limit: at most 30 changes per minute.","retryable":true,"hint":"Wait a minute, then retry once.","docs":"https://idlescreens.com/playbook.md","retryAfterSeconds":30}}"#), 200)
        }
        do {
            try await client(transport).setSeed(channelId: "c", token: "t", seed: 1)
            XCTFail("expected an error")
        } catch let error as MCPError {
            XCTAssertEqual(error, .tool(MCPToolFailure(
                tool: "setSeed", code: "rate_limited", message: "Rate limit: at most 30 changes per minute.",
                hint: "Wait a minute, then retry once.", retryable: true)))
            XCTAssertEqual(error.displayText, "Rate limit: at most 30 changes per minute. Wait a minute, then retry once.")
        }
    }

    func testAttributionRequiredSurfacesTheServerSentence() async throws {
        let transport = MockTransport()
        transport.handler = { _ in
            (Self.reply(
                text: #"{"error":"publishScene changes a channel, so it needs `intent`."}"#, isError: true,
                structured: #"{"error":{"code":"attribution_required","message":"publishScene changes a channel, so it needs `intent`.","retryable":true,"hint":"Re-send with intent, e.g. {\"name\":\"publishScene\"}","missing":["intent"]}}"#), 200)
        }
        do {
            try await client(transport).publishScene(channelId: "c", token: "t", saverId: "warp", seed: 1)
            XCTFail("expected an error")
        } catch let error as MCPError {
            XCTAssertEqual(error.code, "attribution_required")
            // The sentence, not the agent-directed JSON hint.
            XCTAssertEqual(error.displayText, "publishScene changes a channel, so it needs `intent`.")
        }
    }

    func testOldServerTextErrorStillReadsAsASentence() async throws {
        let transport = MockTransport()
        transport.handler = { _ in
            (Self.reply(text: #"{"error":"This channel is protected."}"#, isError: true), 200)
        }
        do {
            try await client(transport).setSeed(channelId: "c", token: "t", seed: 1)
            XCTFail("expected an error")
        } catch let error as MCPError {
            XCTAssertEqual(error, .tool(MCPToolFailure(tool: "setSeed", message: "This channel is protected.")))
        }
    }

    /// Every success now carries a structuredContent of the tool's own shape.
    /// Decoding it strictly would turn every success into invalidResponse.
    func testSuccessWithArbitraryStructuredContentStillDecodes() async throws {
        let transport = MockTransport()
        transport.handler = { _ in
            (Self.reply(
                text: #"{"channelId":"c","token":"isk_new"}"#,
                structured: #"{"channelId":"c","token":"isk_new","error":"not-an-object","undo":{"tool":"recallScene","args":{"sceneId":3}},"list":[1,"two",null]}"#), 200)
        }
        let created = try await client(transport).createChannel(label: "x")
        XCTAssertEqual(created, CreatedChannel(channelId: "c", token: "isk_new"))
    }
}

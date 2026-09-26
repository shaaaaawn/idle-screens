import XCTest

@testable import IdleScreens

final class AgentPresenceTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_800_000_000)

  private func line(_ obj: [String: Any]) -> String {
    String(decoding: try! JSONSerialization.data(withJSONObject: obj), as: UTF8.self)
  }
  private func assistant(_ blocks: [[String: Any]], stop: String? = nil, at: String = "2027-01-15T08:00:00.000Z", sidechain: Bool = false) -> String {
    var msg: [String: Any] = ["role": "assistant", "content": blocks]
    if let stop { msg["stop_reason"] = stop }
    return line(["type": "assistant", "message": msg, "timestamp": at, "isSidechain": sidechain])
  }
  private func user(_ content: Any) -> String {
    line(["type": "user", "message": ["role": "user", "content": content], "timestamp": "2027-01-15T08:00:00.000Z"])
  }

  // MARK: T0

  func testAgentsAreRecognisedByTheirOwnBasenameOnly() {
    XCTAssertEqual(AgentPresence.provider(forExecutable: "/Users/x/Library/Application Support/Claude/claude-code/2.1.280/claude.app/Contents/MacOS/claude"), "claude")
    XCTAssertEqual(AgentPresence.provider(forExecutable: "/opt/homebrew/bin/codex"), "codex")
    // A wrapper, the desktop app, or a path that merely mentions claude is not an agent.
    XCTAssertNil(AgentPresence.provider(forExecutable: "/Applications/Claude.app/Contents/Helpers/disclaimer"))
    XCTAssertNil(AgentPresence.provider(forExecutable: "/Applications/Claude.app/Contents/MacOS/Claude"))
    XCTAssertNil(AgentPresence.provider(forExecutable: "/private/tmp/claude-501/x/python3"))
  }

  func testMonitorProbesAreNotCrew() {
    XCTAssertTrue(AgentPresence.isProbe(cwd: "/Users/x/Library/Application Support/CodexBar/ClaudeProbe"))
    XCTAssertFalse(AgentPresence.isProbe(cwd: "/Users/x/code/idle-mono"))
  }

  // MARK: T1

  func testProjectDirectoryNameMatchesClaudeCode() {
    XCTAssertEqual(AgentPresence.projectDirName(forCwd: "/Users/shawn/code/idle-mono"), "-Users-shawn-code-idle-mono")
    XCTAssertEqual(AgentPresence.projectDirName(forCwd: "/Users/a/Library/Application Support/x.y"), "-Users-a-Library-Application-Support-x-y")
  }

  func testTranscriptTailMapsToCrewStates() {
    func state(_ lines: [String], age: TimeInterval = 5) -> AgentPresence.State {
      AgentPresence.classify(AgentPresence.parseTail(lines), mtime: now.addingTimeInterval(-age), now: now).state
    }
    XCTAssertEqual(state([user("fix the bug"), assistant([["type": "tool_use", "name": "Edit"]], stop: "tool_use")]), .editing)
    XCTAssertEqual(state([assistant([["type": "tool_use", "name": "Grep"]])]), .reading)
    XCTAssertEqual(state([assistant([["type": "tool_use", "name": "Bash"]])]), .running)
    XCTAssertEqual(state([assistant([["type": "tool_use", "name": "mcp__github__create_pr"]])]), .browsing)
    XCTAssertEqual(state([assistant([["type": "tool_use", "name": "Bash"]]), user([["type": "tool_result"]])]), .thinking)
    XCTAssertEqual(state([assistant([["type": "text"]], stop: "end_turn")]), .done)
    XCTAssertEqual(state([user("a new prompt")]), .thinking)
    // Metadata records and subagent (sidechain) records never decide the state.
    XCTAssertEqual(
      state([assistant([["type": "text"]], stop: "end_turn"), line(["type": "custom-title", "customTitle": "x"]),
             assistant([["type": "tool_use", "name": "Edit"]], sidechain: true)]),
      .done)
  }

  func testStaleWorkGoesIdleAndOldDoneFades() {
    let editing = AgentPresence.parseTail([assistant([["type": "tool_use", "name": "Edit"]])])
    XCTAssertEqual(AgentPresence.classify(editing, mtime: now.addingTimeInterval(-11 * 60), now: now).state, .idle)
    let done = AgentPresence.parseTail([assistant([["type": "text"]], stop: "end_turn")])
    XCTAssertEqual(AgentPresence.classify(done, mtime: now.addingTimeInterval(-20 * 60), now: now).state, .done)
    XCTAssertEqual(AgentPresence.classify(done, mtime: now.addingTimeInterval(-31 * 60), now: now).state, .idle)
    XCTAssertEqual(AgentPresence.classify([], mtime: now, now: now).state, .idle)
  }

  func testLoadCountsToolCallsInTheLastMinute() {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let recent = iso.string(from: now.addingTimeInterval(-20)), old = iso.string(from: now.addingTimeInterval(-300))
    let records = AgentPresence.parseTail([
      assistant([["type": "tool_use", "name": "Read"]], at: old),
      assistant([["type": "tool_use", "name": "Read"]], at: recent),
      assistant([["type": "tool_use", "name": "Edit"]], at: recent),
    ])
    XCTAssertEqual(AgentPresence.classify(records, mtime: now, now: now).load, 2)
  }

  func testParsingKeepsNoMessageText() {
    let records = AgentPresence.parseTail([user("rotate sk_live_secret"), assistant([["type": "text", "text": "the password is hunter2"]], stop: "end_turn")])
    XCTAssertFalse(String(describing: records).contains("sk_live"))
    XCTAssertFalse(String(describing: records).contains("hunter2"))
  }

  // MARK: T2

  func testHooksGiveTheStatesATranscriptCannot() {
    XCTAssertEqual(AgentPresence.hookEffect(["hook_event_name": "PermissionRequest"]).state, .waiting)
    XCTAssertEqual(AgentPresence.hookEffect(["hook_event_name": "Notification", "notification_type": "idle_prompt"]).state, .waiting)
    XCTAssertNil(AgentPresence.hookEffect(["hook_event_name": "Notification", "notification_type": "auth_success"]).state)
    XCTAssertEqual(AgentPresence.hookEffect(["hook_event_name": "StopFailure"]).state, .error)
    XCTAssertEqual(AgentPresence.hookEffect(["hook_event_name": "SubagentStart", "agent_id": "a"]).helperDelta, 1)
    XCTAssertEqual(AgentPresence.hookEffect(["hook_event_name": "SubagentStop", "agent_id": "a"]).helperDelta, -1)
    // A subagent's permission prompt or stop is not its parent's.
    XCTAssertNil(AgentPresence.hookEffect(["hook_event_name": "PermissionRequest", "agent_id": "a"]).state)
    XCTAssertNil(AgentPresence.hookEffect(["hook_event_name": "Stop", "agent_id": "a"]).state)
  }

  func testHTTPBodyWaitsForTheWholeRequest() {
    let head = "POST /hook HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 12\r\n\r\n"
    XCTAssertNil(AgentPresence.httpBody(Data((head + "{\"a\":").utf8)))
    XCTAssertEqual(AgentPresence.httpBody(Data((head + "{\"a\": \"bcd\"}").utf8)).map { String(decoding: $0, as: UTF8.self) }, "{\"a\": \"bcd\"}")
    XCTAssertNil(AgentPresence.httpBody(Data("POST /hook HTTP/1.1\r\n".utf8)))
  }

  func testHooksSetupIsValidJSONForClaudeCode() throws {
    let obj = try JSONSerialization.jsonObject(with: Data(AgentPresence.hooksSettingsJSON().utf8)) as? [String: Any]
    let hooks = try XCTUnwrap(obj?["hooks"] as? [String: Any])
    XCTAssertNotNil(hooks["PermissionRequest"])
    XCTAssertTrue(AgentPresence.hooksSettingsJSON().contains("http://127.0.0.1:\(AgentPresence.hookPort)/hook"))
  }

  // MARK: The SaverSpec roster input

  func testRosterJSONIsTheSpecRosterShapeAndNothingMore() throws {
    let m = AgentPresence.Member(slot: 3, state: .waiting, alias: "api", helpers: 2, load: 9, provider: "claude")
    let items = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(AgentPresence.rosterJSON([m]).utf8)) as? [[String: Any]])
    XCTAssertEqual(items.count, 1)
    XCTAssertEqual(Set(items[0].keys), ["slot", "state", "label", "count", "level"])
    XCTAssertEqual(items[0]["state"] as? String, "waiting")
    XCTAssertEqual(items[0]["label"] as? String, "api")
    XCTAssertEqual(items[0]["count"] as? Int, 2)
  }

  // MARK: Presentation

  func testMenuLinesReadLikeTheStation() {
    let m = AgentPresence.Member(slot: 0, state: .waiting, alias: "api", helpers: 0, load: 0, provider: "claude")
    XCTAssertEqual(AgentPresence.menuLine(m), "api — needs you")
    var busy = m
    busy.state = .editing
    busy.helpers = 2
    XCTAssertEqual(AgentPresence.menuLine(busy), "api — editing · 2 helpers")
    XCTAssertEqual(AgentPresence.alias(forCwd: "/Users/x/code/Personal-Agent-Workspace"), "personal-age")
  }
}

import Darwin
import Foundation
import Network

/// Local-first presence for coding agents on this Mac — who is working, on
/// what, and who needs you — gathered without any server and without setup.
///
/// Three tiers, merged per session (docs/agent-worlds.md §9 in the mono):
/// - T0 processes: libproc enumeration of `claude` / `codex` / `pi` executables
///   and their working directories. Never reads a process environment (it holds
///   secrets) and matches the executable's own basename, so a wrapper or a path
///   that merely contains "claude" is not an agent.
/// - T1 transcripts: the tail (last 64 KB) of each Claude Code session log —
///   record types and tool names only, never message bodies — gives the working
///   verb, "thinking" and "done".
/// - T2 hooks (optional): Claude Code `type: "http"` hooks POSTed to a port on
///   127.0.0.1 give the states a transcript can't: waiting for you, stuck,
///   compacting, and helper (subagent) counts. There is no "permission granted"
///   event, so a hook state only holds until the transcript moves again.
///
/// Output is a roster of at most `slots` members with stable slot numbers.
/// `rosterJSON` is the SaverSpec roster input shape — `{slot, state, label,
/// count, level}` — so any scene that declares a `crew` input (the shipped
/// `outpost`, or one an agent authors) can be fed it, locally, with no
/// knowledge of where the data came from.
final class AgentPresence {
  enum State: String, Codable, CaseIterable {
    case absent, idle, thinking, reading, editing, running, browsing, compacting, done, waiting, error
  }

  struct Member: Codable, Equatable {
    var slot: Int
    var state: State
    var alias: String
    var helpers: Int
    var load: Int
    var provider: String
  }

  static let slots = 8
  static let hookPort: UInt16 = 7788

  /// Called on the main thread whenever the roster changes.
  var onChange: (([Member]) -> Void)?
  private(set) var roster: [Member] = []

  private let queue = DispatchQueue(label: "idle-screens.presence", qos: .utility)
  private var timer: DispatchSourceTimer?
  private var interval: TimeInterval = 8
  private var slotOf: [String: Int] = [:]
  private var hookStates: [String: HookState] = [:]  // keyed by transcript path (or session id)
  private var tailCache: [String: TailCache] = [:]
  private var listener: NWListener?

  // MARK: - Lifecycle

  /// Scan every `interval` seconds (fast while the station is on screen).
  func start(interval: TimeInterval = 8) {
    queue.async { [weak self] in
      guard let self else { return }
      self.interval = interval
      self.timer?.cancel()
      let t = DispatchSource.makeTimerSource(queue: self.queue)
      t.schedule(deadline: .now(), repeating: interval, leeway: .milliseconds(250))
      t.setEventHandler { [weak self] in self?.scan() }
      t.resume()
      self.timer = t
    }
  }

  func setInterval(_ seconds: TimeInterval) {
    guard seconds != interval else { return }
    start(interval: seconds)
  }

  func stop() {
    queue.async { [weak self] in
      self?.timer?.cancel()
      self?.timer = nil
    }
  }

  /// One synchronous scan, for `--crew` and tests of the live machine.
  func scanNow() -> [Member] {
    queue.sync { _ = scan(notify: false) }
    return roster
  }

  // MARK: - Scan

  @discardableResult
  private func scan(notify: Bool = true) -> [Member] {
    let now = Date()
    let procs = Self.agentProcesses()
    var sessions: [Session] = []

    // Claude: match each project's processes to its newest transcripts.
    let byCwd = Dictionary(grouping: procs.filter { $0.provider == "claude" }, by: \.cwd)
    for (cwd, group) in byCwd {
      let files = Self.recentTranscripts(forCwd: cwd, limit: group.count)
      for (i, proc) in group.sorted(by: { $0.started > $1.started }).enumerated() {
        let file = i < files.count ? files[i] : nil
        var s = Session(key: file?.path ?? "pid:\(proc.pid)", provider: "claude", cwd: cwd)
        if let file {
          let tail = readTail(file, now: now)
          s.state = tail.state
          s.load = tail.load
          s.lastActivity = file.mtime
        } else {
          s.state = .idle
        }
        sessions.append(s)
      }
    }
    // Codex and pi: presence plus activity from the process alone (T0).
    for proc in procs where proc.provider != "claude" {
      var s = Session(key: "pid:\(proc.pid)", provider: proc.provider, cwd: proc.cwd)
      s.state = .thinking
      sessions.append(s)
    }

    // T2: a hook state wins until the transcript moves past it.
    for i in sessions.indices {
      guard let h = hookStates[sessions[i].key] else { continue }
      sessions[i].helpers = h.helpers
      if let hs = h.state, h.at >= (sessions[i].lastActivity ?? .distantPast).addingTimeInterval(-1) {
        sessions[i].state = hs
      }
    }

    let members = assignSlots(sessions)
    if members != roster {
      roster = members
      if notify {
        let snapshot = members
        DispatchQueue.main.async { [weak self] in self?.onChange?(snapshot) }
      }
    }
    return members
  }

  private struct Session {
    var key: String
    var provider: String
    var cwd: String
    var state: State = .idle
    var load = 0
    var helpers = 0
    var lastActivity: Date?
  }

  /// Stable slots: a session keeps its slot while it lives; new ones take the lowest free.
  private func assignSlots(_ sessions: [Session]) -> [Member] {
    let live = Set(sessions.map(\.key))
    slotOf = slotOf.filter { live.contains($0.key) }
    var used = Set(slotOf.values)
    for s in sessions where slotOf[s.key] == nil {
      guard let free = (0..<Self.slots).first(where: { !used.contains($0) }) else { break }
      slotOf[s.key] = free
      used.insert(free)
    }
    var aliasCount: [String: Int] = [:]
    return sessions.compactMap { s -> Member? in
      guard let slot = slotOf[s.key] else { return nil }
      return Member(slot: slot, state: s.state, alias: "", helpers: s.helpers, load: s.load, provider: s.provider)
        .withAlias(Self.alias(forCwd: s.cwd), &aliasCount)
    }.sorted { $0.slot < $1.slot }
  }

  // MARK: - T0: processes (libproc; no environment, no subprocess)

  struct AgentProcess {
    var pid: pid_t
    var provider: String
    var cwd: String
    var started: Int
  }

  /// Executables that are agents, by their own basename.
  static func provider(forExecutable path: String) -> String? {
    switch (path as NSString).lastPathComponent {
    case "claude": return "claude"
    case "codex": return "codex"
    case "pi": return "pi"
    default: return nil
    }
  }

  /// Monitors' own probe sessions (CodexBar's, ours) are not crew.
  static func isProbe(cwd: String) -> Bool {
    cwd.contains("/CodexBar/ClaudeProbe") || cwd.contains("/idle-screens/probe")
  }

  static func agentProcesses() -> [AgentProcess] {
    let capacity = Int(proc_listallpids(nil, 0)) + 64
    var pids = [pid_t](repeating: 0, count: max(capacity, 64))
    let n = Int(proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size)))
    guard n > 0 else { return [] }
    var out: [AgentProcess] = []
    var pathBuf = [CChar](repeating: 0, count: 4096)
    for pid in pids.prefix(n) where pid > 0 {
      guard proc_pidpath(pid, &pathBuf, UInt32(pathBuf.count)) > 0 else { continue }
      let path = String(cString: pathBuf)
      guard let provider = provider(forExecutable: path) else { continue }
      var vinfo = proc_vnodepathinfo()
      let vsize = Int32(MemoryLayout<proc_vnodepathinfo>.size)
      guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &vinfo, vsize) == vsize else { continue }
      let cwd = withUnsafePointer(to: &vinfo.pvi_cdir.vip_path) {
        $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) }
      }
      guard !cwd.isEmpty, !isProbe(cwd: cwd) else { continue }
      var binfo = proc_bsdinfo()
      let bsize = Int32(MemoryLayout<proc_bsdinfo>.size)
      let started = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &binfo, bsize) == bsize ? Int(binfo.pbi_start_tvsec) : 0
      out.append(AgentProcess(pid: pid, provider: provider, cwd: cwd, started: started))
      if out.count >= 64 { break }  // budget, as CodexBar does
    }
    return out
  }

  // MARK: - T1: Claude transcripts

  struct TranscriptFile {
    var path: String
    var mtime: Date
    var size: Int
  }

  /// Claude Code's project directory name for a working directory.
  static func projectDirName(forCwd cwd: String) -> String {
    String(cwd.map { $0.isLetter || $0.isNumber ? $0 : "-" })
  }

  static func recentTranscripts(forCwd cwd: String, limit: Int, home: String = NSHomeDirectory()) -> [TranscriptFile] {
    let dir = "\(home)/.claude/projects/\(projectDirName(forCwd: cwd))"
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
    let files = names.filter { $0.hasSuffix(".jsonl") }.prefix(512).compactMap { name -> TranscriptFile? in
      let path = "\(dir)/\(name)"
      guard let a = try? FileManager.default.attributesOfItem(atPath: path),
        let m = a[.modificationDate] as? Date
      else { return nil }
      return TranscriptFile(path: path, mtime: m, size: (a[.size] as? Int) ?? 0)
    }
    return Array(files.sorted { $0.mtime > $1.mtime }.prefix(limit))
  }

  private struct TailCache {
    var mtime: Date
    var size: Int
    var records: [TailRecord]
  }

  /// Re-read a tail only when the file changed; classify against `now` every scan.
  private func readTail(_ file: TranscriptFile, now: Date) -> (state: State, load: Int) {
    let records: [TailRecord]
    if let c = tailCache[file.path], c.mtime == file.mtime, c.size == file.size {
      records = c.records
    } else {
      records = Self.parseTail(Self.tailLines(path: file.path))
      tailCache[file.path] = TailCache(mtime: file.mtime, size: file.size, records: records)
      if tailCache.count > 64 { tailCache.removeAll() }
    }
    return Self.classify(records, mtime: file.mtime, now: now)
  }

  static func tailLines(path: String, bytes: Int = 64 * 1024) -> [String] {
    guard let h = FileHandle(forReadingAtPath: path) else { return [] }
    defer { try? h.close() }
    let end = (try? h.seekToEnd()) ?? 0
    let start = end > UInt64(bytes) ? end - UInt64(bytes) : 0
    try? h.seek(toOffset: start)
    let data = (try? h.readToEnd()) ?? Data()
    var lines = String(decoding: data, as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
    if start > 0, !lines.isEmpty { lines.removeFirst() }  // a partial first line
    return lines
  }

  /// Only what classification needs survives parsing: no text, no tool input.
  struct TailRecord: Equatable {
    enum Kind: Equatable { case prompt, toolResult, toolUse(String), thinking, endTurn, compact }
    var kind: Kind
    var at: Date?
  }

  static func parseTail(_ lines: [String]) -> [TailRecord] {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return lines.compactMap { line -> TailRecord? in
      guard let data = line.data(using: .utf8),
        let r = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        (r["isSidechain"] as? Bool) != true
      else { return nil }
      let at = (r["timestamp"] as? String).flatMap { iso.date(from: $0) }
      let type = r["type"] as? String
      if type == "system", ((r["subtype"] as? String) ?? "").contains("compact") { return TailRecord(kind: .compact, at: at) }
      guard type == "assistant" || type == "user", let msg = r["message"] as? [String: Any] else { return nil }
      if type == "user" {
        if let blocks = msg["content"] as? [[String: Any]], blocks.contains(where: { $0["type"] as? String == "tool_result" }) {
          return TailRecord(kind: .toolResult, at: at)
        }
        return TailRecord(kind: .prompt, at: at)
      }
      let blocks = msg["content"] as? [[String: Any]] ?? []
      if let use = blocks.last(where: { $0["type"] as? String == "tool_use" }), let name = use["name"] as? String {
        return TailRecord(kind: .toolUse(name), at: at)
      }
      if msg["stop_reason"] as? String == "end_turn" { return TailRecord(kind: .endTurn, at: at) }
      return TailRecord(kind: .thinking, at: at)
    }
  }

  /// Working verb for a tool, the same map as the mono bridge's `toolState`.
  static func toolState(_ name: String) -> State {
    switch name {
    case "Read", "Grep", "Glob", "LS", "NotebookRead", "TodoRead": return .reading
    case "Edit", "MultiEdit", "Write", "NotebookEdit", "TodoWrite": return .editing
    case "Bash", "BashOutput", "KillShell", "KillBash": return .running
    case "WebFetch", "WebSearch": return .browsing
    default: return name.hasPrefix("mcp__") ? .browsing : .thinking
    }
  }

  /// The state a transcript tail implies. Stale work demotes to idle; a
  /// finished turn reads as done for 30 minutes, then idle.
  static func classify(_ records: [TailRecord], mtime: Date, now: Date) -> (state: State, load: Int) {
    let load = records.filter {
      if case .toolUse = $0.kind, let at = $0.at { return now.timeIntervalSince(at) <= 60 }
      return false
    }.count
    let age = now.timeIntervalSince(mtime)
    guard let last = records.last else { return (.idle, load) }
    var state: State
    switch last.kind {
    case .toolUse(let name): state = toolState(name)
    case .endTurn: state = .done
    case .compact: state = .compacting
    case .prompt, .toolResult, .thinking: state = .thinking
    }
    if state == .done, age > 30 * 60 { state = .idle }
    if state != .done, state != .idle, age > 10 * 60 { state = .idle }
    return (state, load)
  }

  // MARK: - T2: hooks on 127.0.0.1

  private struct HookState {
    var state: State?
    var helpers: Int
    var at: Date
  }

  /// The state (if any) a hook event sets, and the helper-count change.
  static func hookEffect(_ ev: [String: Any]) -> (state: State?, helperDelta: Int) {
    let name = ev["hook_event_name"] as? String ?? ""
    let fromSubagent = ev["agent_id"] != nil && !name.hasPrefix("Subagent")
    switch name {
    case "PermissionRequest": return (fromSubagent ? nil : .waiting, 0)
    case "Notification":
      let text = "\(ev["notification_type"] ?? "") \(ev["message"] ?? "")".lowercased()
      let needsYou = ["permission", "needs_input", "need_input", "idle_prompt", "elicitation_dialog", "elicitation_url_dialog", "waiting for your input"]
      return (needsYou.contains(where: text.contains) ? .waiting : nil, 0)
    case "StopFailure": return (.error, 0)
    case "PreCompact": return (.compacting, 0)
    case "Stop": return (fromSubagent ? nil : .done, 0)
    case "SubagentStart": return (nil, 1)
    case "SubagentStop": return (nil, -1)
    case "SessionEnd": return (.absent, 0)
    default: return (nil, 0)  // tool and prompt events: the transcript already says it
    }
  }

  func applyHook(_ ev: [String: Any], at: Date = Date()) {
    queue.async { [weak self] in
      guard let self else { return }
      let key = (ev["transcript_path"] as? String) ?? "session:\(ev["session_id"] ?? "")"
      let (state, delta) = Self.hookEffect(ev)
      var h = self.hookStates[key] ?? HookState(state: nil, helpers: 0, at: at)
      h.helpers = max(0, h.helpers + delta)
      if let state { h.state = state; h.at = at }
      self.hookStates[key] = h
      if self.hookStates.count > 128 { self.hookStates.removeAll() }
      self.scan()
    }
  }

  /// Listen for hook POSTs on 127.0.0.1. Idempotent; logs and carries on if the port is taken.
  func startHookListener(port: UInt16 = AgentPresence.hookPort) {
    guard listener == nil, let nwPort = NWEndpoint.Port(rawValue: port) else { return }
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort)
    guard let l = try? NWListener(using: params) else { return }
    l.newConnectionHandler = { [weak self] conn in self?.serve(conn) }
    l.stateUpdateHandler = { state in
      if case .failed(let err) = state { NSLog("[idle-screens] hook listener failed: \(err)") }
    }
    l.start(queue: queue)
    listener = l
  }

  private func serve(_ conn: NWConnection) {
    conn.start(queue: queue)
    var buffer = Data()
    func receive() {
      conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, done, _ in
        if let data { buffer.append(data) }
        if let body = Self.httpBody(buffer) {
          if let ev = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] { self?.applyHook(ev) }
          // An empty JSON object: hooks must never block or change the agent's decision.
          let reply = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
          conn.send(content: reply.data(using: .utf8), completion: .contentProcessed { _ in conn.cancel() })
        } else if done || buffer.count > 1_000_000 {
          conn.cancel()
        } else {
          receive()
        }
      }
    }
    receive()
  }

  /// The body of a complete HTTP request, or nil while it is still arriving.
  static func httpBody(_ raw: Data) -> Data? {
    guard let sep = raw.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(decoding: raw[..<sep.lowerBound], as: UTF8.self).lowercased()
    let length = head.split(separator: "\r\n")
      .first { $0.hasPrefix("content-length:") }
      .flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
    let body = raw[sep.upperBound...]
    return body.count >= length ? Data(body.prefix(length)) : nil
  }

  /// The hooks block to paste into ~/.claude/settings.json.
  static func hooksSettingsJSON(port: UInt16 = AgentPresence.hookPort) -> String {
    let events = ["PermissionRequest", "Notification", "Stop", "StopFailure", "PreCompact", "SubagentStart", "SubagentStop", "SessionEnd"]
    let entry = "[{\"hooks\": [{\"type\": \"http\", \"url\": \"http://127.0.0.1:\(port)/hook\", \"timeout\": 2}]}]"
    let body = events.map { "    \"\($0)\": \(entry)" }.joined(separator: ",\n")
    return "{\n  \"hooks\": {\n\(body)\n  }\n}"
  }

  // MARK: - Presentation

  static func alias(forCwd cwd: String) -> String {
    let base = (cwd as NSString).lastPathComponent
    return String((base.isEmpty ? "agent" : base).lowercased().prefix(12))
  }

  static func menuLine(_ m: Member) -> String {
    let verb: String
    switch m.state {
    case .waiting: verb = "needs you"
    case .error: verb = "stuck"
    case .done: verb = "done"
    case .idle: verb = "resting"
    case .compacting: verb = "tidying up"
    default: verb = m.state.rawValue
    }
    let helpers = m.helpers > 0 ? " · \(m.helpers) helper\(m.helpers > 1 ? "s" : "")" : ""
    return "\(m.alias) — \(verb)\(helpers)"
  }

  /// The roster as a SaverSpec `roster` input value (see FORMAT.md `inputs`).
  static func rosterJSON(_ roster: [Member]) -> String {
    let items: [[String: Any]] = roster.map {
      ["slot": $0.slot, "state": $0.state.rawValue, "label": $0.alias, "count": $0.helpers, "level": $0.load]
    }
    let data = (try? JSONSerialization.data(withJSONObject: items, options: [.sortedKeys])) ?? Data("[]".utf8)
    return String(decoding: data, as: UTF8.self)
  }

  static func json(_ roster: [Member]) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    return (try? enc.encode(roster)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
  }
}

private extension AgentPresence.Member {
  /// Two agents in one project read "api" and "api·2".
  func withAlias(_ base: String, _ seen: inout [String: Int]) -> AgentPresence.Member {
    var m = self
    let n = (seen[base] ?? 0) + 1
    seen[base] = n
    m.alias = n == 1 ? base : "\(base.prefix(10))·\(n)"
    return m
  }
}

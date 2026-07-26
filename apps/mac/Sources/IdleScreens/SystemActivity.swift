import Foundation

/// Snapshot of developer-relevant background activity on this machine:
/// Docker containers, Apple `container` containers, MCP server processes, and
/// listening dev servers. Everything is gathered by shelling out to CLIs that
/// may or may not be installed — each section degrades to empty when its tool
/// is missing, its daemon is down, or the call times out.
enum SystemActivity {
  struct Snapshot {
    var docker: [String] = []
    var apple: [String] = []
    var mcp: [String] = []
    var servers: [String] = []
    var isEmpty: Bool { docker.isEmpty && apple.isEmpty && mcp.isEmpty && servers.isEmpty }
  }

  /// Max lines shown per section; the rest collapse into a "+N more" line.
  static let sectionCap = 8

  // MARK: - Collection

  /// Gather a snapshot off the main thread; completion runs on the main thread.
  static func snapshot(_ completion: @escaping (Snapshot) -> Void) {
    DispatchQueue.global(qos: .utility).async {
      var snap = Snapshot()
      if let out = run(find("docker"), ["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"]) {
        snap.docker = parseDockerPS(out)
      }
      if let out = run(find("container"), ["list"]) {
        snap.apple = parseContainerList(out)
      }
      if let out = run("/bin/ps", ["-axo", "pid=,command="]) {
        snap.mcp = parseMCPProcesses(out)
      }
      if let out = run("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]) {
        snap.servers = parseListeners(out)
      }
      DispatchQueue.main.async { completion(snap) }
    }
  }

  // MARK: - Parsers (pure, unit-tested)

  /// `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'` → "name — image (status)".
  static func parseDockerPS(_ out: String) -> [String] {
    out.split(separator: "\n").compactMap { line in
      let f = line.split(separator: "\t", omittingEmptySubsequences: false)
      guard f.count >= 2, !f[0].isEmpty else { return nil }
      let status = f.count >= 3 && !f[2].isEmpty ? " (\(f[2]))" : ""
      return "\(f[0]) — \(f[1])\(status)"
    }
  }

  /// Apple `container list` table (ID IMAGE OS ARCH STATE ADDR) → "id (image)".
  static func parseContainerList(_ out: String) -> [String] {
    out.split(separator: "\n")
      .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
      .filter { !$0.uppercased().hasPrefix("ID") }  // header row
      .compactMap { line in
        let f = line.split(separator: " ", omittingEmptySubsequences: true)
        guard let id = f.first else { return nil }
        return f.count >= 2 ? "\(id) (\(f[1]))" : String(id)
      }
  }

  /// `ps -axo pid=,command=` lines whose command mentions "mcp" →
  /// "binary · mcp-ish-token [pid]", with identical labels grouped as "… ×N"
  /// (agent sessions spawn the same MCP server many times over).
  /// Excludes this app and the ps call itself.
  static func parseMCPProcesses(_ out: String) -> [String] {
    let entries: [(label: String, pid: String)] = out.split(separator: "\n").compactMap { line in
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard let space = trimmed.firstIndex(of: " ") else { return nil }
      let pid = trimmed[..<space]
      let command = trimmed[trimmed.index(after: space)...].trimmingCharacters(in: .whitespaces)
      let lower = command.lowercased()
      let mcpish = { (s: String) in s.contains("mcp") || s.contains("modelcontextprotocol") }
      guard mcpish(lower), !lower.hasPrefix("ps "),
        !lower.contains("idlescreens")
      else { return nil }
      let tokens = command.split(separator: " ")
      let binary = tokens.first.map { URL(fileURLWithPath: String($0)).lastPathComponent } ?? "?"
      // The most descriptive name: within the first mcp-ish token, the path
      // segment that names the MCP — or, for an npm scope (@scope/pkg), the
      // package segment that follows it.
      let hint = tokens.dropFirst().first { mcpish($0.lowercased()) }.flatMap {
        token -> String? in
        let segments = token.split(separator: "/")
        guard let i = segments.firstIndex(where: { mcpish($0.lowercased()) }) else { return nil }
        if segments[i].hasPrefix("@"), i + 1 < segments.count {
          return String(segments[i + 1])
        }
        return String(segments[i])
      }
      let label = hint.map { "\(binary) · \($0)" } ?? binary
      return (String(label.prefix(60)), String(pid))
    }
    var counts: [String: Int] = [:]
    var order: [String] = []
    var firstPid: [String: String] = [:]
    for entry in entries {
      if counts[entry.label] == nil {
        order.append(entry.label)
        firstPid[entry.label] = entry.pid
      }
      counts[entry.label, default: 0] += 1
    }
    return order.map { label in
      let n = counts[label] ?? 1
      return n > 1 ? "\(label) ×\(n)" : "\(label) [\(firstPid[label] ?? "?")]"
    }
  }

  /// `lsof -nP -iTCP -sTCP:LISTEN` → "cmd :port [pid]" for dev-ish processes,
  /// deduped (IPv4/IPv6 double-report) and sorted by port.
  static func parseListeners(_ out: String) -> [String] {
    let devPrefixes = [
      "node", "bun", "deno", "python", "ruby", "php", "workerd", "wrangler",
      "vite", "esbuild", "caddy", "http", "serve", "flask", "rails",
    ]
    var seen = Set<String>()
    var entries: [(port: Int, line: String)] = []
    for line in out.split(separator: "\n").dropFirst() {
      let f = line.split(separator: " ", omittingEmptySubsequences: true)
      guard f.count >= 9 else { continue }
      let cmd = f[0].lowercased()
      guard devPrefixes.contains(where: { cmd.hasPrefix($0) }) else { continue }
      // Port: digits after the last ':' in the name column (f[8]).
      guard let portStr = f[8].split(separator: ":").last, let port = Int(portStr) else { continue }
      let key = "\(cmd):\(port)"
      guard !seen.contains(key) else { continue }
      seen.insert(key)
      entries.append((port, "\(f[0]) :\(port) [\(f[1])]"))
    }
    return entries.sorted { $0.port < $1.port }.map(\.line)
  }

  // MARK: - Presentation

  /// Cap a section to `sectionCap` lines with a trailing "+N more".
  static func capped(_ lines: [String]) -> [String] {
    guard lines.count > sectionCap else { return lines }
    return Array(lines.prefix(sectionCap)) + ["+\(lines.count - sectionCap) more"]
  }

  /// Sections for the saver HUD (empty sections omitted by the page).
  static func hudSections(_ snap: Snapshot) -> [[String: Any]] {
    [
      ["title": "🐳 Docker", "lines": capped(snap.docker)],
      ["title": "📦 Containers", "lines": capped(snap.apple)],
      ["title": "🔌 MCP", "lines": capped(snap.mcp)],
      ["title": "🌐 Dev Servers", "lines": capped(snap.servers)],
    ]
  }

  /// Plain-text report for the menu alert and the --activity debug flag.
  static func textReport(_ snap: Snapshot) -> String {
    func section(_ title: String, _ lines: [String]) -> String {
      let body = lines.isEmpty ? "  (none)" : capped(lines).map { "  • \($0)" }.joined(separator: "\n")
      return "\(title):\n\(body)"
    }
    return [
      section("Docker containers", snap.docker),
      section("Apple containers", snap.apple),
      section("MCP processes", snap.mcp),
      section("Listening dev servers", snap.servers),
    ].joined(separator: "\n\n")
  }

  // MARK: - Process helpers

  private static func find(_ name: String) -> String? {
    for dir in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"] {
      let path = dir + "/" + name
      if FileManager.default.isExecutableFile(atPath: path) { return path }
    }
    return nil
  }

  /// Run a CLI with a hard timeout. Returns stdout on exit 0, else nil.
  private static func run(_ path: String?, _ args: [String], timeout: TimeInterval = 4) -> String? {
    guard let path, FileManager.default.isExecutableFile(atPath: path) else { return nil }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: path)
    proc.arguments = args
    let stdout = Pipe()
    proc.standardOutput = stdout
    proc.standardError = Pipe()
    do { try proc.run() } catch { return nil }
    let killer = DispatchWorkItem { if proc.isRunning { proc.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
    let data = stdout.fileHandleForReading.readDataToEndOfFile()
    proc.waitUntilExit()
    killer.cancel()
    guard proc.terminationStatus == 0 else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

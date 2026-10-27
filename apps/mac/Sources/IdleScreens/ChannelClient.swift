import Foundation

/// Publishes a scene to an idlescreens.com channel via the site's MCP endpoint
/// (a single stateless JSON-RPC POST — no client library needed). Used by
/// "Cast this Mac" so other screens mirror what this Mac is showing.
enum ChannelClient {
  static var endpoint: URL {
    ServerEndpoint.url("/mcp") ?? URL(string: "https://idlescreens.com/mcp")!
  }

  /// No AI acts here, so — like the web UI (`harness: idlescreens-web`, no
  /// `agent`) — the Mac names its surface and leaves `agent` out. Every write
  /// needs a non-empty `intent` (idle-server PR #250's contract).
  static let harness = "idlescreens-mac"

  /// Deliberately not URLSession's `IdleScreens/<build> CFNetwork/…` default:
  /// the server keeps a compatibility path for that UA (shipped builds that
  /// send no intent). A build that speaks the contract identifies itself so
  /// the server can tell the two apart and retire that path. Never contains
  /// "pi" — the server's older UA heuristic substring-matches it.
  static var userAgent: String {
    "IdleScreens-macOS/\(BuildInfo.appVersion) (\(harness))"
  }

  /// Server errors arrive as a JSON body relayed verbatim through MCP
  /// (`{"error": "This channel is protected…"}`). Show the sentence, not the
  /// JSON — the raw object in an alert reads like a crash.
  static func readableError(_ text: String?) -> String? {
    guard let text, !text.isEmpty else { return nil }
    if let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let message = object["error"] as? String, !message.isEmpty
    {
      return message
    }
    return text
  }

  /// The JSON-RPC body for one cast. Pure, so the contract is testable.
  static func castPayload(saverId: String, channelId: String, seed: UInt32, token: String?)
    -> [String: Any]
  {
    // Claimed channels reject writes without their capability token; the open
    // defaults (default, lobby, studio) ignore it. Send whatever we've stored.
    var arguments: [String: Any] = [
      "channelId": channelId,
      "spec": ["id": saverId],
      "seed": Int(seed & 0x7FFF_FFFF),
      "intent": "user cast \(saverId) from the Mac menu bar",
      "harness": harness,
    ]
    if let token { arguments["token"] = token }
    return [
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": [
        "name": "publishScene",
        "arguments": arguments,
      ],
    ]
  }

  /// Read a tools/call reply: nil on success, else the sentence to show. The
  /// server's error envelope (`structuredContent.error`: code, message, hint)
  /// wins; older servers only put `{"error": …}` in the text block.
  static func failureMessage(_ data: Data?) -> String? {
    let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let result = json?["result"] as? [String: Any]
    guard result?["isError"] as? Bool == true else {
      return json == nil || result == nil ? "Unexpected reply from the server." : nil
    }
    let envelope = (result?["structuredContent"] as? [String: Any])?["error"] as? [String: Any]
    if let message = envelope?["message"] as? String, !message.isEmpty {
      // Hints worth a person's time (wait, retry); agent-directed hints
      // (argument names, JSON examples) stay out of the alert.
      let code = envelope?["code"] as? String ?? ""
      if ["rate_limited", "unavailable"].contains(code),
        let hint = envelope?["hint"] as? String, !hint.isEmpty
      {
        return "\(message) \(hint)"
      }
      return message
    }
    let text = (result?["content"] as? [[String: Any]])?
      .compactMap { $0["text"] as? String }
      .joined(separator: " ")
    return readableError(text) ?? "Publish failed."
  }

  /// Publish a classic saver (by id) to a channel. completion runs on the main
  /// thread with (success, message).
  static func cast(
    saverId: String, channelId: String, seed: UInt32,
    completion: @escaping (Bool, String) -> Void
  ) {
    let payload = castPayload(
      saverId: saverId, channelId: channelId, seed: seed,
      token: ChannelToken.load(for: channelId))
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
      completion(false, "Failed to encode request.")
      return
    }

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    request.httpBody = body

    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        if let error {
          completion(false, "Network error: \(error.localizedDescription)")
          return
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
          completion(false, "Server returned HTTP \(code).")
          return
        }
        // MCP tool errors arrive as HTTP 2xx with result.isError in the JSON body.
        if let failure = failureMessage(data) {
          completion(false, failure)
          return
        }
        // The MCP result text notes confirmed=true when a viewer rendered it.
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let confirmed = text.contains("\"confirmed\": true") || text.contains("confirmed=true")
          || text.contains("\"confirmed\":true")
        completion(
          true,
          confirmed
            ? "Now casting \(saverId) to “\(channelId)”."
            : "Published \(saverId) to “\(channelId)” (no viewer connected yet).")
      }
    }.resume()
  }
}

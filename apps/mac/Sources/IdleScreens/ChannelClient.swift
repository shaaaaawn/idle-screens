import Foundation

/// Publishes a scene to an idlescreens.com channel via the site's MCP endpoint
/// (a single stateless JSON-RPC POST — no client library needed). Used by
/// "Cast this Mac" so other screens mirror what this Mac is showing.
enum ChannelClient {
  static let endpoint = URL(string: "https://idlescreens.com/mcp")!

  /// Publish a classic saver (by id) to a channel. completion runs on the main
  /// thread with (success, message).
  static func cast(
    saverId: String, channelId: String, seed: UInt32,
    completion: @escaping (Bool, String) -> Void
  ) {
    let payload: [String: Any] = [
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": [
        "name": "publishScene",
        "arguments": [
          "channelId": channelId,
          "spec": ["id": saverId],
          "seed": Int(seed & 0x7FFF_FFFF),
        ],
      ],
    ]
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
      completion(false, "Failed to encode request.")
      return
    }

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
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
        // The MCP result text notes confirmed=true when a viewer rendered it.
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let confirmed = text.contains("\"confirmed\": true") || text.contains("confirmed=true")
        completion(
          true,
          confirmed
            ? "Now casting \(saverId) to “\(channelId)”."
            : "Published \(saverId) to “\(channelId)” (no viewer connected yet).")
      }
    }.resume()
  }
}

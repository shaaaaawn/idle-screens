import Foundation

/// This Mac's identity for phone pairing. The device id rides the channel
/// viewer URL (`?device=`) so the viewer's socket registers this screen and a
/// paired iPhone can retarget it with a "switch" push. Codes are minted
/// against `/api/pair/new` and shown to the user to type (or scan) on the
/// phone.
enum PairDevice {
  private static let idKey = "pairDeviceId"

  /// Stable per-install id matching the server's `[A-Za-z0-9-]{8,64}` rule.
  static var deviceId: String {
    let defaults = UserDefaults.standard
    if let id = defaults.string(forKey: idKey), !id.isEmpty { return id }
    let id = "mac-" + UUID().uuidString.lowercased()
    defaults.set(id, forKey: idKey)
    return id
  }

  /// A freshly minted pairing code and everything the UI needs to show it.
  /// `url` is the server's own `/pair/<code>` link — the string the QR encodes
  /// and what the iPhone scanner parses; `expiresAt` drives the countdown.
  struct PairCode {
    let code: String
    let url: URL?
    let expiresAt: Date?

    var secondsRemaining: TimeInterval? {
      expiresAt.map { max(0, $0.timeIntervalSinceNow) }
    }
  }

  /// Mint a 6-char pairing code for this device. Completion runs on main.
  static func mintCode(
    channelId: String?,
    completion: @escaping (Result<PairCode, Error>) -> Void
  ) {
    guard let endpoint = ServerEndpoint.url("/api/pair/new") else {
      completion(.failure(NSError(
        domain: "PairDevice", code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Bad server URL — check the serverBaseURL default."])))
      return
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var body: [String: String] = ["deviceId": deviceId]
    if let channelId, !channelId.isEmpty { body["channelId"] = channelId }
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        if let error {
          completion(.failure(error))
          return
        }
        guard let data,
          let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let code = object["code"] as? String
        else {
          completion(.failure(NSError(
            domain: "PairDevice", code: 1,
            userInfo: [NSLocalizedDescriptionKey:
              "The pairing service is unavailable — try again later."])))
          return
        }
        completion(.success(parse(code: code, from: object)))
      }
    }.resume()
  }

  /// Split out for testing: the server sends `url` and `expiresAt` (epoch ms)
  /// alongside the code, but older servers may not — both stay optional so a
  /// missing field costs the QR or the countdown, never the pairing itself.
  static func parse(code: String, from object: [String: Any]) -> PairCode {
    let local = ServerEndpoint.url("/pair/\(code)")
    // The server builds its link from the request origin, which behind a
    // route/proxy can name a different host than the one we actually minted
    // against (a local wrangler answers with `http://idlescreens.com/pair/…`).
    // A QR pointing at the wrong server is a code that doesn't exist there, so
    // trust the server's link only when it agrees about the host.
    let reported = (object["url"] as? String).flatMap(URL.init(string:))
    let url = (reported?.host == local?.host) ? reported : local
    let expiresAt = (object["expiresAt"] as? Double).map {
      Date(timeIntervalSince1970: $0 / 1000)
    }
    return PairCode(code: code, url: url, expiresAt: expiresAt)
  }
}

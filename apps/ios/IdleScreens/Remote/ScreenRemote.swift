import Foundation

/// Sends a channel to paired screens from outside the app — a widget button,
/// the Control Center control, a shortcut. The same request the app's
/// `push(channelId:to:)` makes, minus what only the app can do: a private
/// channel's viewer key is minted and sealed there, so those sends go
/// through the app (`idlescreens://send/<id>`).
struct ScreenRemote: Sendable {
    let transport: any HTTPTransport
    /// Reads a screen's push token; injected so tests need no Keychain.
    let token: @Sendable (String) -> String?

    init(transport: any HTTPTransport = URLSessionTransport(),
         token: @escaping @Sendable (String) -> String? = { KeychainHelper.load(key: ScreenRemote.tokenKey(for: $0)) }) {
        self.transport = transport
        self.token = token
    }

    /// Where each screen's `isp_` push token is kept (shared with AppState).
    static func tokenKey(for deviceId: String) -> String { "pair.token.\(deviceId)" }

    /// The app's own link for a send it has to make itself.
    static func appLink(channelId: String, screenId: String? = nil) -> URL? {
        var parts = URLComponents()
        parts.scheme = "idlescreens"
        parts.host = "send"
        parts.path = "/" + channelId
        if let screenId { parts.queryItems = [URLQueryItem(name: "screen", value: screenId)] }
        return parts.url
    }

    /// Parses `idlescreens://send/<channel>[?screen=<deviceId>]`.
    static func parseAppLink(_ url: URL) -> (channelId: String, screenId: String?)? {
        guard url.scheme == "idlescreens", url.host == "send" else { return nil }
        let id = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !id.isEmpty else { return nil }
        let screen = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "screen" }?.value
        return (id, screen)
    }

    /// Send `channel` to one screen, or every paired screen when `screenId`
    /// is nil. Never throws: the outcome says what happened, for the widget.
    func send(_ channel: RemoteSnapshot.Channel, to screenId: String?, in snapshot: RemoteSnapshot) async -> SendOutcome {
        let targets = snapshot.screens.filter { screenId == nil || $0.deviceId == screenId }
        guard let base = URL(string: snapshot.baseURL) else {
            return SendOutcome(channelId: channel.id, channelLabel: channel.label, delivered: [],
                               asked: targets.count, unanswered: [], at: Date())
        }
        let client = PairClient(baseURL: base, transport: transport)
        var delivered: [String] = [], unanswered: [String] = []
        await withTaskGroup(of: (String, Result).self) { group in
            for screen in targets {
                let pairToken = token(screen.deviceId)
                group.addTask {
                    guard let pairToken else { return (screen.deviceId, .failed) }
                    do {
                        try await client.push(pairToken: pairToken, channelId: channel.id)
                        return (screen.deviceId, .delivered)
                    } catch PairError.httpError(let status, _) where status == 409 {
                        return (screen.deviceId, .unanswered)
                    } catch {
                        return (screen.deviceId, .failed)
                    }
                }
            }
            for await (id, result) in group {
                switch result {
                case .delivered: delivered.append(id)
                case .unanswered: unanswered.append(id)
                case .failed: break
                }
            }
        }
        return SendOutcome(channelId: channel.id, channelLabel: channel.label, delivered: delivered.sorted(),
                           asked: targets.count, unanswered: unanswered.sorted(), at: Date())
    }

    private enum Result: Sendable { case delivered, unanswered, failed }
}

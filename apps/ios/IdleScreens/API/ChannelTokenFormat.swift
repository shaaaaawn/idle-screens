import Foundation

/// Parsing and validation for the two strings that attach an existing channel:
/// its id and its `isk_` capability token.
///
/// Both arrive by copy-paste from somewhere else — another device, a note, a
/// share sheet — so what gets pasted is often a whole URL rather than the bare
/// id. Recognising that locally is the difference between "attached" and a
/// round trip that fails with a 404 the user can't interpret.
enum ChannelTokenFormat {
    static let tokenPrefix = "isk_"

    /// Pull a channel id out of whatever was pasted: a bare id, a viewer URL
    /// (`https://idlescreens.com/channel/<id>`), or a channel API path
    /// (`/c/<id>/...`).
    static func channelId(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), url.scheme != nil {
            let parts = url.pathComponents.filter { $0 != "/" }
            for marker in ["channel", "c"] {
                if let i = parts.firstIndex(of: marker), parts.indices.contains(i + 1) {
                    return sanitizeId(parts[i + 1])
                }
            }
        }
        return sanitizeId(trimmed)
    }

    /// The server's own id charset (`worker.ts` strips everything else), so an
    /// id that survives this is one the server can actually look up.
    static func sanitizeId(_ raw: String) -> String? {
        let kept = raw.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        guard !kept.isEmpty else { return nil }
        return String(kept.prefix(64))
    }

    /// Tokens are pasted, so leading/trailing whitespace and a stray newline
    /// from a terminal copy are expected rather than exceptional.
    static func normalizeToken(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isPlausibleToken(_ raw: String) -> Bool {
        let token = normalizeToken(raw)
        return token.hasPrefix(tokenPrefix) && token.count > tokenPrefix.count
    }

    /// The app's own handoff link, `idlescreens://channel/<id>#token=<isk_…>`:
    /// what the delegation sheet shares, a freshly minted key offers, and the
    /// key backup writes as each restore line. The token rides in the
    /// FRAGMENT, the same rule idlescreens.com follows (a credential never
    /// goes in a query string), so one shape works whether the link is opened
    /// by the app or pasted into a browser. Set through `URLComponents`, so
    /// anything outside the fragment charset is percent-encoded.
    static func handoffLink(channelId: String, token: String) -> String {
        var parts = URLComponents()
        parts.scheme = "idlescreens"
        parts.host = "channel"
        parts.path = "/" + (sanitizeId(channelId) ?? channelId)
        parts.fragment = "token=\(normalizeToken(token))"
        return parts.string ?? "idlescreens://channel/\(channelId)#token=\(token)"
    }

    /// A handoff link: `idlescreens://channel/<id>#token=<isk_…>`, or the
    /// https equivalent (`https://idlescreens.com/channel/<id>/remote#token=…`,
    /// the desktop & web share). The token is read from the fragment first and
    /// then from the query, so `?token=` links already shared or printed in a
    /// key backup keep working. Returns nil unless BOTH halves are present and
    /// the token is plausible — a link carrying only an id is just a viewer
    /// link and must not be mistaken for a grant of control.
    static func handoff(from url: URL) -> (channelId: String, token: String)? {
        // A custom-scheme URL puts "channel" in the HOST, not the path
        // (idlescreens://channel/lobby → host=channel, path=/lobby), so the
        // https-shaped path scan misses it and the whole URL string would get
        // sanitised into a nonsense id. Same trap as the pair-code URL.
        let parts = url.pathComponents.filter { $0 != "/" }
        let id: String?
        if url.scheme == "idlescreens", url.host == "channel" {
            id = parts.first.flatMap(sanitizeId)
        } else {
            id = channelId(from: url.absoluteString)
        }
        guard let id else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard let raw = fragmentToken(components?.percentEncodedFragment)
                ?? components?.queryItems?.first(where: { $0.name == "token" })?.value else { return nil }
        let token = normalizeToken(raw)
        guard isPlausibleToken(token) else { return nil }
        return (id, token)
    }

    /// `token=<value>` out of a fragment shaped like a query (`token=…&x`).
    /// Split by hand rather than re-parsed through `URLComponents.query`, whose
    /// setter traps on input it considers malformed.
    private static func fragmentToken(_ fragment: String?) -> String? {
        guard let fragment, !fragment.isEmpty else { return nil }
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2, kv[0] == "token" else { continue }
            let value = String(kv[1])
            return value.removingPercentEncoding ?? value
        }
        return nil
    }

    /// Why a token looks wrong, said before spending a network round trip on
    /// it. nil means "nothing obviously wrong" — not "verified".
    static func tokenProblem(_ raw: String) -> String? {
        let token = normalizeToken(raw)
        if token.isEmpty { return nil }
        if !token.hasPrefix(tokenPrefix) {
            // The most common paste mix-up: the pair token, which does the
            // wrong job entirely.
            if token.hasPrefix("isp_") {
                return "That's a screen pairing token. Channel tokens start with isk_."
            }
            return "Channel tokens start with \(tokenPrefix)."
        }
        if token.count <= tokenPrefix.count { return "That token looks incomplete." }
        return nil
    }
}

import Foundation

/// Normalisation and validation for the 6-character screen pairing code.
///
/// The server mints codes from a deliberately no-lookalike alphabet — no
/// `0/O`, `1/I/L` — so a code read off a TV across the room can't be mistyped
/// into a different valid code (`idle-server/src/worker.ts`, `/api/pair/new`).
/// Mirroring the alphabet here lets the field reject a bad character while
/// it's being typed instead of after a round trip that says "check the code".
enum PairCodeFormat {
    /// MIRRORS THE SERVER: `idle-server/src/worker.ts`, `/api/pair/new`. If
    /// the server's alphabet changes and this doesn't, the field starts
    /// rejecting characters the server just minted.
    static let alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    static let length = 6

    /// Characters the server deliberately excluded, grouped by what they look
    /// like. BOTH members of each pair are excluded — the server didn't pick a
    /// winner, it dropped the whole ambiguity — so there is no "did you mean
    /// X": the user misread some other character and needs to look again.
    private static let excludedGroups: [Set<Character>] = [
        ["0", "O"],
        ["1", "I", "L"],
    ]

    /// Turn whatever the user gave us into a code, or nil.
    ///
    /// Accepts a bare code, a pairing URL (`https://idlescreens.com/pair/X`
    /// or `idlescreens://pair/X` — the Mac host shows the URL and the TV's QR
    /// encodes it), and tolerates spaces, hyphens and lowercase.
    static func normalize(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // A URL must be unwrapped BEFORE stripping punctuation. Stripping
        // first turns https://idlescreens.com/pair/K7M2PW into
        // HTTPSIDLESCREENSCOMPAIRK7M2PW — a wrong code the server rejects
        // with "check the code on your screen", which sends the user hunting
        // for a typo that isn't there.
        if let url = URL(string: trimmed), url.scheme != nil,
           let fromURL = pairCode(fromURL: url) {
            return sanitize(fromURL)
        }
        return sanitize(trimmed)
    }

    /// Keep only alphabet characters, uppercased, capped at the code length.
    static func sanitize(_ raw: String) -> String? {
        let kept = raw.uppercased().filter { alphabet.contains($0) }
        guard !kept.isEmpty else { return nil }
        return String(kept.prefix(length))
    }

    /// Filter for live text-field input: same rules, but an empty result is
    /// "" rather than nil so the field can be cleared.
    static func filterInput(_ raw: String) -> String {
        if let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           url.scheme != nil, let code = pairCode(fromURL: url) {
            return sanitize(code) ?? ""
        }
        return sanitize(raw) ?? ""
    }

    static func isComplete(_ code: String) -> Bool {
        code.count == length && code.allSatisfy { alphabet.contains($0) }
    }

    /// The excluded character the user just typed, if any — so the field can
    /// name it instead of silently eating the keystroke.
    static func rejectedCharacter(in raw: String) -> Character? {
        raw.uppercased().first { character in
            excludedGroups.contains { $0.contains(character) }
        }
    }

    static func hint(for character: Character) -> String {
        guard let group = excludedGroups.first(where: { $0.contains(character) }) else {
            return "Codes don't use \(character)."
        }
        let listed = group.sorted().map(String.init).joined(separator: " or ")
        return "Codes never use \(listed) — check your screen again."
    }

    /// Extract the code from a pairing URL. Handles the universal link
    /// (`https://idlescreens.com/pair/<code>`) and the custom scheme
    /// (`idlescreens://pair/<code>`).
    static func pairCode(fromURL url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "idlescreens", url.host == "pair", let code = parts.first {
            return code
        }
        if let i = parts.firstIndex(of: "pair"), parts.indices.contains(i + 1) {
            return parts[i + 1]
        }
        return nil
    }
}

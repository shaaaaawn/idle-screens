import Foundation

enum VJError: LocalizedError {
    case noToken(channelId: String)
    case tokenDeclined(channelId: String)
    case noScene(channelId: String)

    var errorDescription: String? {
        switch self {
        case .noToken(let channelId): "No capability token stored for '\(channelId)'"
        case .tokenDeclined(let channelId): "Token declined by '\(channelId)'"
        case .noScene(let channelId): "'\(channelId)' has no scene to mix in yet"
        }
    }
}

extension AppState {
    func token(for channelId: String) -> String? {
        store.token(for: channelId)
    }

    /// Create (claim) a new channel. Returns the capability token so the UI can
    /// show it exactly once — it is also stored in the Keychain immediately.
    /// A starter saver goes on air right away: a freshly created channel must
    /// never be dead air the user is left to figure out.
    @discardableResult
    func createChannel(label: String, tags: [String]) async throws -> String {
        isWorking = true
        defer { isWorking = false }
        let created = try await mcp.createChannel(label: label, tags: tags)
        let credential = ChannelCredential(
            channelId: created.channelId,
            label: label.isEmpty ? created.channelId : label,
            createdAt: Date()
        )
        credentials.append(credential)
        store.save(credentials)
        store.setToken(created.token, for: created.channelId)
        await publishStarter(to: created.channelId)
        return created.token
    }

    /// Best-effort: put something beautiful on air immediately after creation.
    /// Failure is silent — the channel still exists and the deck still works.
    private func publishStarter(to channelId: String) async {
        await loadSavers()
        let preferred = ["warp", "starfield", "aquarium", "toasters"]
        let starter = preferred.compactMap { id in savers.first { $0.id == id } }.first
            ?? savers.randomElement()
        guard let starter else { return }
        try? await publish(saver: starter, to: channelId)
    }

    /// Fork any channel's current scene into a new channel you own. This is
    /// the fastest path from "I like that" to "I can steer it" — the server
    /// does it atomically and hands back the token, so there's no window
    /// where the channel exists but isn't yours.
    @discardableResult
    func remix(_ sourceChannelId: String, label: String? = nil) async throws -> ChannelCredential {
        isWorking = true
        defer { isWorking = false }
        let source = channels.first { $0.id == sourceChannelId }
        let name = label?.isEmpty == false
            ? label!
            : "\(source?.displayLabel ?? sourceChannelId) remix"
        let created = try await mcp.remixChannel(sourceChannelId: sourceChannelId, label: name)
        let credential = ChannelCredential(
            channelId: created.channelId, label: name, createdAt: Date())
        credentials.append(credential)
        store.save(credentials)
        store.setToken(created.token, for: created.channelId)
        await loadGallery()
        return credential
    }

    /// Adopt another channel's current scene onto one you already own —
    /// "mix": keep the channel (and its viewers/screens), change what plays.
    func adoptScene(from sourceChannelId: String, into channelId: String) async throws {
        let token = try requireToken(for: channelId)
        guard let spec = rawSpec(of: sourceChannelId) else {
            throw VJError.noScene(channelId: sourceChannelId)
        }
        isWorking = true
        defer { isWorking = false }
        try await mcp.publishSpec(
            channelId: channelId, token: token, spec: spec,
            seed: Self.randomSeed(), intent: "mixed in the scene from \(sourceChannelId)")
    }

    /// The gallery payload carries each channel's spec verbatim — publish
    /// THAT, not a re-encoded SpecSubset (which would drop every field the
    /// native renderer happens not to read).
    private func rawSpec(of channelId: String) -> JSONValue? {
        channels.first { $0.id == channelId }?.rawSpec
    }

    /// Add a channel created elsewhere. The token is verified against
    /// `/c/:id/verify` before anything is persisted.
    func addExistingChannel(channelId: String, token: String) async throws {
        isWorking = true
        defer { isWorking = false }
        let approved = try await gallery.verify(channelId: channelId, token: token)
        guard approved else { throw VJError.tokenDeclined(channelId: channelId) }
        if !credentials.contains(where: { $0.channelId == channelId }) {
            // Use the channel's public label when the gallery knows it —
            // "velvet-meadow-fc / velvet-meadow-fc" rows read as broken.
            let label = channels.first { $0.id == channelId }?.displayLabel ?? channelId
            credentials.append(ChannelCredential(channelId: channelId, label: label, createdAt: Date()))
            store.save(credentials)
        }
        store.setToken(token, for: channelId)
    }

    func removeChannel(_ credential: ChannelCredential) {
        credentials.removeAll { $0.channelId == credential.channelId }
        store.save(credentials)
        store.removeToken(for: credential.channelId)
    }

    // MARK: Deck operations

    func loadSavers() async {
        guard savers.isEmpty else { return }
        do {
            savers = try await mcp.listSavers()
        } catch {
            vjError = error.localizedDescription
        }
    }

    /// Publish a saver to the channel with a fresh random seed.
    func publish(saver: SaverInfo, to channelId: String) async throws {
        let token = try requireToken(for: channelId)
        try await mcp.publishScene(
            channelId: channelId,
            token: token,
            saverId: saver.id,
            seed: Self.randomSeed(),
            intent: "published from iOS VJ remote"
        )
    }

    /// Re-roll the channel's seed. Returns the new seed.
    @discardableResult
    func shuffleSeed(for channelId: String) async throws -> Int {
        let token = try requireToken(for: channelId)
        let seed = Self.randomSeed()
        try await mcp.setSeed(channelId: channelId, token: token, seed: seed)
        return seed
    }

    func setSleeping(_ sleeping: Bool, for channelId: String) async throws {
        let token = try requireToken(for: channelId)
        if sleeping {
            try await mcp.sleep(channelId: channelId, token: token)
        } else {
            try await mcp.wake(channelId: channelId, token: token)
        }
    }

    /// Flash ephemeral text over the channel — tag "vj", 4s on screen.
    func sendOverlay(_ text: String, to channelId: String) async throws {
        let token = try requireToken(for: channelId)
        try await mcp.overlay(channelId: channelId, token: token, text: text, tag: "vj", ttl: 4000)
    }

    /// Public read-only state for the deck's status header.
    func fetchState(for channelId: String) async throws -> ChannelState {
        try await gallery.fetchState(channelId: channelId)
    }

    // MARK: Helpers

    private func requireToken(for channelId: String) throws -> String {
        guard let token = store.token(for: channelId) else {
            throw VJError.noToken(channelId: channelId)
        }
        return token
    }

    private static func randomSeed() -> Int {
        Int.random(in: 0...Int(Int32.max))
    }
}

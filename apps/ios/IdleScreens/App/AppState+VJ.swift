import Foundation

enum VJError: LocalizedError {
    case noToken(channelId: String)
    case tokenDeclined(channelId: String)

    var errorDescription: String? {
        switch self {
        case .noToken(let channelId): "No capability token stored for '\(channelId)'"
        case .tokenDeclined(let channelId): "Token declined by '\(channelId)'"
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

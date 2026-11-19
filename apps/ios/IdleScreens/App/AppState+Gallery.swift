import Foundation

extension AppState {
    /// Refresh the public channel gallery. On a cold start the disk cache
    /// hydrates the UI immediately; the network result replaces it when it
    /// lands (or is silently kept stale on error — cached beats empty).
    func loadGallery() async {
        if channels.isEmpty, let cached = await gallery.cachedChannels() {
            let visible = hidden.visible(cached)
            details.absorb(visible)
            channels = details.apply(to: visible)
        }
        if categories.isEmpty, let cached = await gallery.cachedCategories() {
            categories = cached
        }
        isLoadingGallery = true
        defer { isLoadingGallery = false; galleryAttempted = true }
        do {
            // Shelves are an enhancement: a categories failure must never cost
            // the wall itself, so it is fetched alongside and allowed to fail.
            async let shelves = try? gallery.fetchCategories()
            let listed = hidden.visible(try await gallery.fetchChannels())
            // Scenes can land while the keyring rows are read, so they are
            // applied after that await, not before it. Only to the listed
            // rows: a private row's read was gated by its key, and a refused
            // placeholder must not be filled from a scene cached before.
            let privateRows = await keyringPrivateChannels(missingFrom: listed)
            let fresh = details.apply(to: listed) + privateRows
            // A private row added while this load was in flight (a key just
            // saved, `addExistingChannel`) is kept, not overwritten.
            let ids = Set(fresh.map(\.id))
            let keyring = Set(credentials.map(\.channelId))
            let added = channels.filter { row in
                row.access == "private" && !ids.contains(row.id) && !hidden.isHidden(row.id)
                    && keyring.contains(row.id)
            }
            channels = fresh + added
            details.refresh(channels)
            if let fresh = await shelves { categories = fresh }
            galleryError = nil
            galleryLoadedAt = Date()
            refreshRemoteSnapshot()
        } catch {
            // The listing failing costs the listing, not the keyring: each
            // private channel is its own read.
            await addKeyringPrivateChannels()
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
    }

    /// The private channels this phone holds a key for. The listing never
    /// carries one (private forces unlisted), so a viewer key opened nothing
    /// to watch; this puts each on the wall, read with its key. Public
    /// channels missing from the listing (unlisted, not private) are left
    /// out, as before. Fetched together, and a failure costs only that row.
    func keyringPrivateChannels(missingFrom listed: [PublicChannel]) async -> [PublicChannel] {
        let known = Set(listed.map(\.id))
        let wanted = credentials.filter { !known.contains($0.channelId) && !hidden.isHidden($0.channelId) }
        guard !wanted.isEmpty else { return [] }
        let gallery = self.gallery
        let reads = await withTaskGroup(of: (String, GalleryClient.KeyringRead).self) { group in
            for credential in wanted {
                group.addTask {
                    (credential.channelId,
                     await gallery.readKeyringChannel(channelId: credential.channelId, label: credential.label))
                }
            }
            var reads: [(String, GalleryClient.KeyringRead)] = []
            for await read in group { reads.append(read) }
            return reads
        }
        var rows: [PublicChannel] = []
        for (id, read) in reads {
            switch read {
            case .privateRow(let row): rows.append(row); keyringPublicIds.remove(id)
            // Unlisted but public: the widget can send it without the app.
            case .isPublic: keyringPublicIds.insert(id)
            // A failed read says nothing; what was learned before stands.
            case .unknown: break
            }
        }
        // Hidden, or taken off the keyring, while the reads were in flight:
        // still out.
        let keyring = Set(credentials.map(\.channelId))
        let kept = rows.filter { keyring.contains($0.id) && !hidden.isHidden($0.id) }.sorted { $0.id < $1.id }
        // Each is a whole `/state`, scene included: a tile showing one has
        // nothing to fetch.
        details.absorb(kept)
        return kept
    }

    /// Add the keyring's private channels to a wall painted from the cache.
    /// `staleAfter`: skip when they were added this recently, so each Watch
    /// appearance is not a `/state` read per keyring channel.
    func addKeyringPrivateChannels(staleAfter: TimeInterval = 0) async {
        if staleAfter > 0, let at = keyringRowsAddedAt, Date().timeIntervalSince(at) < staleAfter { return }
        keyringRowsAddedAt = Date()
        let extra = await keyringPrivateChannels(missingFrom: channels)
        let known = Set(channels.map(\.id))
        channels += extra.filter { !known.contains($0.id) }
    }

    /// A tile showing `channel` is on screen: fetch its scene if the one
    /// known is missing or older than the listing's row. Cheap to call on
    /// every appearance.
    func wantDetail(_ channel: PublicChannel) {
        details.want(channel)
    }

    /// The tile left the screen before its scene was asked for.
    func unwantDetail(_ channelId: String) {
        details.unwant(channelId)
    }

    /// `channel` as the wall has it now. A view handed a copy (a shelf's feed
    /// holds the list it was opened with) reads the scene through this, so a
    /// scene that landed after it was built still reaches it.
    func current(_ channel: PublicChannel) -> PublicChannel {
        channels.first { $0.id == channel.id } ?? channel
    }

    /// Scenes that landed, into the rows that show them — one write for the
    /// batch.
    func mergeDetails(_ batch: [String: ChannelDetail]) {
        guard channels.contains(where: { batch[$0.id] != nil }) else { return }
        channels = ChannelDetails.merge(batch, into: channels)
    }

    /// Take a channel off this device's wall, now and on every reload.
    func hideChannel(_ channelId: String) {
        hidden.hide(channelId)
        channels.removeAll { $0.id == channelId }
    }

    /// Put a hidden channel back; it returns with the next fetch.
    func unhideChannel(_ channelId: String) async {
        hidden.unhide(channelId)
        await loadGallery()
    }
}

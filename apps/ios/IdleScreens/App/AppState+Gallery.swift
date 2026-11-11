import Foundation

extension AppState {
    /// Refresh the public channel gallery. On a cold start the disk cache
    /// hydrates the UI immediately; the network result replaces it when it
    /// lands (or is silently kept stale on error — cached beats empty).
    func loadGallery() async {
        if channels.isEmpty, let cached = await gallery.cachedChannels() {
            channels = hidden.visible(cached)
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
            let fresh = listed + (await keyringPrivateChannels(missingFrom: listed))
            // A private row added while this load was in flight (a key just
            // saved, `addExistingChannel`) is kept, not overwritten.
            let ids = Set(fresh.map(\.id))
            let keyring = Set(credentials.map(\.channelId))
            let added = channels.filter { row in
                row.access == "private" && !ids.contains(row.id) && !hidden.isHidden(row.id)
                    && keyring.contains(row.id)
            }
            channels = fresh + added
            if let fresh = await shelves { categories = fresh }
            galleryError = nil
            galleryLoadedAt = Date()
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
        let rows = await withTaskGroup(of: PublicChannel?.self) { group in
            for credential in wanted {
                group.addTask {
                    await gallery.fetchPrivateChannel(channelId: credential.channelId, label: credential.label)
                }
            }
            var rows: [PublicChannel] = []
            for await row in group { if let row { rows.append(row) } }
            return rows
        }
        // Hidden, or taken off the keyring, while the reads were in flight:
        // still out.
        let keyring = Set(credentials.map(\.channelId))
        return rows.filter { keyring.contains($0.id) && !hidden.isHidden($0.id) }.sorted { $0.id < $1.id }
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

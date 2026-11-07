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
            channels = listed + (await keyringPrivateChannels(missingFrom: listed))
            if let fresh = await shelves { categories = fresh }
            galleryError = nil
            galleryLoadedAt = Date()
        } catch {
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
        return await withTaskGroup(of: PublicChannel?.self) { group in
            for credential in wanted {
                group.addTask {
                    await gallery.fetchPrivateChannel(channelId: credential.channelId, label: credential.label)
                }
            }
            var rows: [PublicChannel] = []
            for await row in group { if let row { rows.append(row) } }
            return rows.sorted { $0.id < $1.id }
        }
    }

    /// Add the keyring's private channels to a wall painted from the cache.
    func addKeyringPrivateChannels() async {
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

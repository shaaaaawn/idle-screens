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
            channels = hidden.visible(try await gallery.fetchChannels())
            if let fresh = await shelves { categories = fresh }
            galleryError = nil
            galleryLoadedAt = Date()
        } catch {
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
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

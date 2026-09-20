import Foundation

extension AppState {
    /// Refresh the public channel gallery. On a cold start the disk cache
    /// hydrates the UI immediately; the network result replaces it when it
    /// lands (or is silently kept stale on error — cached beats empty).
    func loadGallery() async {
        if channels.isEmpty, let cached = await gallery.cachedChannels() {
            channels = cached
        }
        if categories.isEmpty, let cached = await gallery.cachedCategories() {
            categories = cached
        }
        isLoadingGallery = true
        defer { isLoadingGallery = false }
        do {
            // Shelves are an enhancement: a categories failure must never cost
            // the wall itself, so it is fetched alongside and allowed to fail.
            async let shelves = try? gallery.fetchCategories()
            channels = try await gallery.fetchChannels()
            if let fresh = await shelves { categories = fresh }
            galleryError = nil
        } catch {
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
    }
}

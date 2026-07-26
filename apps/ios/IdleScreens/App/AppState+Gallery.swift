import Foundation

extension AppState {
    /// Refresh the public channel gallery. On a cold start the disk cache
    /// hydrates the UI immediately; the network result replaces it when it
    /// lands (or is silently kept stale on error — cached beats empty).
    func loadGallery() async {
        if channels.isEmpty, let cached = await gallery.cachedChannels() {
            channels = cached
        }
        isLoadingGallery = true
        defer { isLoadingGallery = false }
        do {
            channels = try await gallery.fetchChannels()
            galleryError = nil
        } catch {
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
    }
}

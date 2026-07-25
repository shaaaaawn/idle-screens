import Foundation

extension AppState {
    /// Refresh the public channel gallery.
    func loadGallery() async {
        isLoadingGallery = true
        defer { isLoadingGallery = false }
        do {
            channels = try await gallery.fetchChannels()
            galleryError = nil
        } catch {
            galleryError = error.localizedDescription
        }
    }
}

import Foundation
import Observation

/// Global app state — holds the API clients, credential store, and shared UI state.
/// Feature slices live in `AppState+Gallery.swift` (Watch) and `AppState+VJ.swift` (VJ).
@MainActor @Observable
final class AppState {
    let mcp: MCPClient
    let gallery: GalleryClient
    let store: CredentialStore

    // MARK: Gallery (Watch)

    var channels: [PublicChannel] = []
    var isLoadingGallery = false
    var galleryError: String?

    // MARK: VJ

    var credentials: [ChannelCredential] = []
    var savers: [SaverInfo] = []
    var isWorking = false
    var vjError: String?

    init() {
        let baseURL = URL(string: Config.baseURL)!
        let transport = URLSessionTransport()
        self.mcp = MCPClient(baseURL: baseURL, transport: transport)
        self.gallery = GalleryClient(baseURL: baseURL, transport: transport)
        self.store = CredentialStore()
        self.credentials = store.load()
    }

    /// Test-friendly initializer — inject clients backed by a mock transport.
    init(mcp: MCPClient, gallery: GalleryClient, store: CredentialStore) {
        self.mcp = mcp
        self.gallery = gallery
        self.store = store
        self.credentials = store.load()
    }
}

// MARK: - App configuration

enum Config {
    static let baseURL: String = {
        ProcessInfo.processInfo.environment["IDLE_SCREENS_BASE_URL"]
            ?? "https://idlescreens.com"
    }()
}

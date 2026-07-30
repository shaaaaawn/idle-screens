import Foundation
import Observation

/// Global app state — holds the API clients, credential store, and shared UI state.
/// Feature slices live in `AppState+Gallery.swift` (Watch) and `AppState+VJ.swift` (VJ).
@MainActor @Observable
final class AppState {
    let mcp: MCPClient
    let gallery: GalleryClient
    let pairClient: PairClient
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

    // MARK: TV pairing

    var pairedScreens: [PairedScreen] = []
    var isPairing = false
    /// Failure pushing a channel to an already-paired screen.
    var pairPushError: String?
    /// Failure claiming a pair code. Separate from `pairPushError` so a failed
    /// push doesn't surface as a stale error inside "Add a screen".
    var pairClaimError: String?

    init() {
        let baseURL = URL(string: Config.baseURL)!
        let transport = URLSessionTransport()
        self.mcp = MCPClient(baseURL: baseURL, transport: transport)
        self.gallery = GalleryClient(baseURL: baseURL, transport: transport)
        self.pairClient = PairClient(baseURL: baseURL, transport: transport)
        self.store = CredentialStore()
        self.credentials = store.load()
        self.pairedScreens = Self.loadPairedScreens()
    }

    /// Test-friendly initializer — inject clients backed by a mock transport.
    init(mcp: MCPClient, gallery: GalleryClient, pairClient: PairClient? = nil, store: CredentialStore) {
        self.mcp = mcp
        self.gallery = gallery
        self.pairClient = pairClient
            ?? PairClient(baseURL: URL(string: Config.baseURL)!)
        self.store = store
        self.credentials = store.load()
        self.pairedScreens = Self.loadPairedScreens()
    }
}

// MARK: - App configuration

enum Config {
    static let baseURL: String = {
        ProcessInfo.processInfo.environment["IDLE_SCREENS_BASE_URL"]
            ?? "https://idlescreens.com"
    }()
}

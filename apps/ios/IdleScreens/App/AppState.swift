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
    /// Editorial shelves from `/api/categories` — the same catalog the web
    /// home page groups on, so the two surfaces show the same wall.
    var categories: [ChannelCategory] = []
    /// Past scenes, fetched once and shared by the feed, its neighbours and
    /// the channel timeline.
    let scenes = RecordedSceneStore()
    /// Channels this person follows — theirs alone, synced by iCloud Keychain.
    let follows = FollowStore()
    var isLoadingGallery = false
    var galleryError: String?
    /// A gallery fetch has come back (either way). Until then an empty list
    /// means "not asked yet", never "nothing on air" — that screen used to
    /// flash on every launch before the first fetch had even started.
    var galleryAttempted = false
    var galleryLoadedAt: Date?

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
        // Every write is attributed (intent + harness) and any server
        // confirmation is put to the person — see MCPClient.callTool.
        self.mcp = MCPClient(baseURL: baseURL, transport: transport,
                             identity: .current(), confirmer: MCPConfirmPrompt.confirmer)
        self.gallery = GalleryClient(baseURL: baseURL, transport: transport)
        self.pairClient = PairClient(baseURL: baseURL, transport: transport)
        self.store = CredentialStore()
        self.credentials = store.load()
        self.pairedScreens = Self.loadPairedScreens()
        // The wall as it was last time, on the very first frame: launch opens
        // onto a channel, not onto a loading state. A small file; reading it
        // here beats a frame of nothing.
        self.channels = gallery.cachedChannels() ?? []
        self.categories = gallery.cachedCategories() ?? []
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

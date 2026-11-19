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
    /// The scenes the slim listing leaves out, fetched per channel as tiles
    /// show (`wantDetail`) and merged into `channels` as they land.
    @ObservationIgnored let details: ChannelDetails
    /// Editorial shelves from `/api/categories` — the same catalog the web
    /// home page groups on, so the two surfaces show the same wall.
    var categories: [ChannelCategory] = []
    /// Past scenes, fetched once and shared by the feed, its neighbours and
    /// the channel timeline.
    let scenes = RecordedSceneStore()
    /// Channels this person follows — theirs alone, synced by iCloud Keychain.
    let follows = FollowStore()
    /// Channels this person hid (Report → Hide). Filtered out of `channels`
    /// wherever the wall is loaded, so no surface has to remember to.
    let hidden = HiddenChannels()
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
    /// Screens following what this device watches (Sync). Empty = not syncing.
    var syncTargets: [String] = []
    @ObservationIgnored var syncTask: Task<Void, Never>?
    @ObservationIgnored var lastSynced: SyncTarget?
    /// The target a sync send is waiting to settle on; nil once it is sent.
    @ObservationIgnored var pendingSync: SyncTarget?
    /// The viewer key being checked or minted for one screen and channel
    /// (`screenViewerKeyKey`), so two pushes at once share one grant.
    @ObservationIgnored var screenKeyMints: [String: Task<String, Error>] = [:]
    /// When the keyring's private channels were last added to a cached wall.
    @ObservationIgnored var keyringRowsAddedAt: Date?
    /// Keyring channels the listing leaves out (unlisted) whose own `/state`
    /// says they are public. Without it the widget took every one of them for
    /// private and made its tile open the app instead of sending.
    @ObservationIgnored var keyringPublicIds: Set<String> = []
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
        let store = CredentialStore()
        // A private channel's reads need the key this phone holds for it.
        self.gallery = GalleryClient(baseURL: baseURL, transport: transport,
                                     key: { store.token(for: $0) })
        self.pairClient = PairClient(baseURL: baseURL, transport: transport)
        self.store = store
        self.credentials = store.load()
        self.pairedScreens = Self.loadPairedScreens()
        // The wall as it was last time, on the very first frame: launch opens
        // onto a channel, not onto a loading state. The slim list is a small
        // file and the scenes are the ones fetched before (each reduced to
        // its spec once); reading them here beats a frame of nothing.
        let details = ChannelDetails(gallery: gallery, cached: gallery.cachedDetails())
        self.details = details
        let cached = hidden.visible(gallery.cachedChannels() ?? [])
        // The first launch after the update reads the full list an earlier
        // build cached, scenes inline: keep them for the slim rows to come.
        details.absorb(cached)
        self.channels = details.apply(to: cached)
        self.categories = gallery.cachedCategories() ?? []
        details.onArrive = { [weak self] batch in self?.mergeDetails(batch) }
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
        self.details = ChannelDetails(gallery: gallery)
        details.onArrive = { [weak self] batch in self?.mergeDetails(batch) }
    }
}

// MARK: - App configuration

enum Config {
    static let baseURL: String = {
        ProcessInfo.processInfo.environment["IDLE_SCREENS_BASE_URL"]
            ?? "https://idlescreens.com"
    }()
}

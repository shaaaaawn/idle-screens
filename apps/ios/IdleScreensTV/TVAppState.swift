import Foundation
import Observation

/// Root state for the tvOS viewer: gallery, channel selection, WS lifecycle,
/// capability tier, and the latest scene data.
@MainActor @Observable
final class TVAppState {
    let gallery: GalleryClient
    let mcp: MCPClient
    let ws: ChannelWSClient
    let pair: PairClient
    let watchdog = FrameWatchdog()

    // MARK: Device identity / pairing

    static let deviceIdKey = "tv.device_id"
    static let lastChannelKey = "tv.last_channel"

    /// Stable identity for this TV, minted once and persisted. A paired
    /// phone addresses switch pushes to this id.
    let deviceId: String

    var pairCode: PairCode?
    var isRequestingPairCode = false
    var pairError: String?

    // MARK: Gallery

    var channels: [PublicChannel] = []
    var isLoadingGallery = false
    var galleryError: String?

    // MARK: Channel / scene

    var selectedChannelId: String?
    var sleeping = false
    var viewers: Int?
    var overlayText: String?
    var currentSpecJSON: JSONValue?
    var compiledScene: [CompiledLayer] = []
    var specBackground: SpecSubset.Background?
    /// True when the channel runs a non-schema spec (e.g. classic saver
    /// `{"id":"warp"}`) — no native render possible, route to the thumb stream.
    var isClassicSpec = false

    // MARK: Capability tier

    static let tierOverrideKey = "tv.tier_override"

    let machine: String
    let detectedTier: CapabilityTier
    /// Set by ThumbStreamView after repeated thumb failures — forces the t0 floor.
    var thumbFailed = false
    private(set) var watchdogDowngraded = false
    /// Learned per-channel caps ("this scene proved too heavy at tier X on
    /// this box") — persisted, applied on every future open of that channel.
    let tierCaps = TierCapStore()
    /// Pre-render complexity cap for the CURRENT scene (transient); set from
    /// SceneComplexity when a schema compiles obviously heavy.
    private(set) var complexityCap: CapabilityTier?


    var tierOverride: CapabilityTier? {
        didSet {
            UserDefaults.standard.set(tierOverride?.rawValue, forKey: Self.tierOverrideKey)
        }
    }

    var effectiveTier: CapabilityTier {
        if thumbFailed { return .t0 }
        var tier = tierOverride ?? detectedTier
        if watchdogDowngraded { tier = tier.downgraded() }
        // Adaptive downscaling for this schema: upfront complexity guess,
        // then anything the watchdog taught us about this channel before.
        if let cap = complexityCap { tier = CapabilityTier.lower(of: tier, cap) }
        if let id = selectedChannelId, let learned = tierCaps.cap(for: id) {
            tier = CapabilityTier.lower(of: tier, learned)
        }
        return tier
    }

    // MARK: Lifecycle

    private var baseURL: URL
    private var wsTask: Task<Void, Never>?

    init(gallery: GalleryClient, mcp: MCPClient, ws: ChannelWSClient, pair: PairClient, baseURL: URL) {
        self.gallery = gallery
        self.mcp = mcp
        self.ws = ws
        self.pair = pair
        self.baseURL = baseURL
        self.machine = CapabilityDetector.machine
        self.detectedTier = CapabilityDetector.tier(forMachine: machine)
        self.tierOverride = UserDefaults.standard
            .string(forKey: Self.tierOverrideKey)
            .flatMap(CapabilityTier.init(rawValue:))
        if let existing = UserDefaults.standard.string(forKey: Self.deviceIdKey) {
            self.deviceId = existing
        } else {
            let minted = UUID().uuidString
            UserDefaults.standard.set(minted, forKey: Self.deviceIdKey)
            self.deviceId = minted
        }
    }

    convenience init() {
        let baseURL = URL(string: TVConfig.baseURL)!
        let transport = URLSessionTransport()
        self.init(
            gallery: GalleryClient(baseURL: baseURL, transport: transport),
            mcp: MCPClient(baseURL: baseURL, transport: transport),
            ws: ChannelWSClient(),
            pair: PairClient(baseURL: baseURL, transport: transport),
            baseURL: baseURL
        )
    }

    func loadGallery() async {
        isLoadingGallery = true
        defer { isLoadingGallery = false }
        // Cache-first: paint the last known channel list instantly (inline
        // specs make it fully renderable), then let the network refresh
        // replace it. A cold boot shows real content in one frame.
        if channels.isEmpty, let cached = await gallery.cachedChannels() {
            channels = cached
        }
        do {
            channels = try await gallery.fetchChannels()
            galleryError = nil
        } catch {
            // Keep showing cached content on refresh failure; only surface
            // the error when there is nothing to show at all.
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
    }

    // MARK: Scene lifecycle

    /// Foreground/background edges from the app. Background: drop the socket
    /// cleanly (suspended apps shouldn't hold one). Foreground: refresh the
    /// gallery (viewer counts go stale) and re-open the right socket.
    func scenePhaseChanged(active: Bool) {
        if active {
            // Cold boot is handled by the launch .task paths; only act when
            // resuming from a real background (socket was torn down below).
            guard wsTask == nil else { return }
            if let current = selectedChannelId {
                openSocket(channelId: current, watching: true)
            } else {
                openSocket(channelId: lastChannelId, watching: false)
                Task { await self.loadGallery() }
            }
        } else {
            wsTask?.cancel()
            wsTask = nil
        }
    }

    // MARK: WS lifecycle

    func selectChannel(_ channelId: String) {
        selectedChannelId = channelId
        sleeping = false
        viewers = nil
        overlayText = nil
        currentSpecJSON = nil
        compiledScene = []
        specBackground = nil
        isClassicSpec = false
        thumbFailed = false
        watchdogDowngraded = false
        complexityCap = nil
        UserDefaults.standard.set(channelId, forKey: Self.lastChannelKey)
        // Instant first frame: the gallery payload carries each channel's
        // inline spec, so render it immediately instead of holding a spinner
        // through the WS handshake. The WS snapshot replaces it on arrival
        // (and classic channels have no decodable inline spec, so they keep
        // the spinner until the snapshot routes them to the thumb stream).
        if let cached = channels.first(where: { $0.id == channelId })?.spec {
            compiledScene = cached.compile(seed: cached.seed ?? 0)
            specBackground = cached.background
            complexityCap = SceneComplexity.precap(for: compiledScene)
        }
        openSocket(channelId: channelId, watching: true)
    }

    func exitChannel() {
        selectedChannelId = nil
        overlayText = nil
        // Stay reachable: keep a socket on the last channel so a paired phone
        // can still push a switch while this TV sits on the grid.
        openSocket(channelId: lastChannelId, watching: false)
    }

    /// The channel whose socket carries pushes while nothing is fullscreen.
    var lastChannelId: String {
        UserDefaults.standard.string(forKey: Self.lastChannelKey) ?? "default"
    }

    /// For the Settings connection panel — where this TV is pointed.
    var serverHost: String { baseURL.host ?? baseURL.absoluteString }

    /// Open (or replace) the single channel socket. `watching: false` is
    /// control-only — scene traffic is ignored, but "switch" pushes still land.
    private func openSocket(channelId: String, watching: Bool) {
        wsTask?.cancel()
        wsTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in await ws.events(
                    baseURL: baseURL,
                    channelId: channelId,
                    deviceId: deviceId
                ) {
                    guard !Task.isCancelled else { break }
                    if watching {
                        self.handle(event)
                    } else if case .switchChannel(let target) = event {
                        self.handle(.switchChannel(channelId: target))
                    }
                }
            } catch {
                // Stream ended with an error — the next openSocket reconnects.
            }
        }
    }

    /// Call once at launch: makes an idle TV reachable for pushes.
    func startControlSocket() {
        guard wsTask == nil else { return }
        openSocket(channelId: lastChannelId, watching: false)
    }

    // MARK: Events

    func handle(_ event: ChannelWSEvent) {
        switch event {
        case .snapshot(let snapshot):
            sleeping = snapshot.sleeping ?? sleeping
            viewers = snapshot.viewers
            if let spec = snapshot.resolvedSpec ?? snapshot.scene ?? snapshot.spec {
                applySpec(spec, fallbackSeed: snapshot.epoch)
            }
        case .scene(let spec, let seed):
            if let spec {
                applySpec(spec, fallbackSeed: seed)
            }
        case .sleep:
            sleeping = true
        case .wake:
            sleeping = false
        case .overlay(let text, let ttl):
            overlayText = text
            let ttlMs = ttl ?? 4000
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(ttlMs))
                guard !Task.isCancelled else { return }
                self?.overlayText = nil
            }
        case .delta:
            break
        case .switchChannel(let channelId):
            if let channelId, !channelId.isEmpty, channelId != selectedChannelId {
                selectChannel(channelId)
            }
        }
    }

    // MARK: Pairing

    /// Mint (or re-mint) a pair code for the QR screen.
    func requestPairCode() async {
        isRequestingPairCode = true
        defer { isRequestingPairCode = false }
        do {
            pairCode = try await pair.createCode(deviceId: deviceId, channelId: selectedChannelId ?? lastChannelId)
            pairError = nil
        } catch {
            pairError = error.localizedDescription
        }
    }

    private func applySpec(_ json: JSONValue, fallbackSeed: Int?) {
        currentSpecJSON = json
        guard let data = try? JSONEncoder().encode(json),
              let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else {
            // Not a schema spec (e.g. classic saver {"id":"warp"}) — no native
            // render. Keep the raw JSON; ScreenSaverView routes to the thumb stream.
            isClassicSpec = true
            compiledScene = []
        complexityCap = SceneComplexity.precap(for: compiledScene)
            specBackground = nil
            return
        }
        // A valid schema spec clears the classic flag (re-publish scenario).
        isClassicSpec = false
        let seed = spec.seed ?? fallbackSeed ?? 0
        compiledScene = spec.compile(seed: seed)
        specBackground = spec.background
    }

    // MARK: Tier reporting

    func watchdogDidTrigger() {
        guard !watchdogDowngraded else { return }
        watchdogDowngraded = true
        // Learn: this channel's scene was too heavy at the tier we just ran.
        // Next open starts at the downgraded tier instead of re-janking.
        if let id = selectedChannelId {
            tierCaps.record(effectiveTier, for: id)
        }
    }

    func reportThumbFailure() {
        thumbFailed = true
    }
}

// MARK: - Configuration

enum TVConfig {
    static let baseURL: String = {
        ProcessInfo.processInfo.environment["IDLE_SCREENS_BASE_URL"]
            ?? "https://idlescreens.com"
    }()
}

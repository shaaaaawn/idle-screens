import Foundation
import Observation

/// Root state for the tvOS viewer: gallery, channel selection, WS lifecycle,
/// capability tier, and the latest scene data.
@MainActor @Observable
final class TVAppState {
    let gallery: GalleryClient
    let mcp: MCPClient
    let ws: ChannelWSClient
    let watchdog = FrameWatchdog()

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

    var tierOverride: CapabilityTier? {
        didSet {
            UserDefaults.standard.set(tierOverride?.rawValue, forKey: Self.tierOverrideKey)
        }
    }

    var effectiveTier: CapabilityTier {
        if thumbFailed { return .t0 }
        var tier = tierOverride ?? detectedTier
        if watchdogDowngraded { tier = tier.downgraded() }
        return tier
    }

    // MARK: Lifecycle

    private var baseURL: URL
    private var wsTask: Task<Void, Never>?

    init(gallery: GalleryClient, mcp: MCPClient, ws: ChannelWSClient, baseURL: URL) {
        self.gallery = gallery
        self.mcp = mcp
        self.ws = ws
        self.baseURL = baseURL
        self.machine = CapabilityDetector.machine
        self.detectedTier = CapabilityDetector.tier(forMachine: machine)
        self.tierOverride = UserDefaults.standard
            .string(forKey: Self.tierOverrideKey)
            .flatMap(CapabilityTier.init(rawValue:))
    }

    convenience init() {
        let baseURL = URL(string: TVConfig.baseURL)!
        let transport = URLSessionTransport()
        self.init(
            gallery: GalleryClient(baseURL: baseURL, transport: transport),
            mcp: MCPClient(baseURL: baseURL, transport: transport),
            ws: ChannelWSClient(),
            baseURL: baseURL
        )
    }

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

    // MARK: WS lifecycle

    func selectChannel(_ channelId: String) {
        wsTask?.cancel()
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

        // Instant first frame: the gallery payload carries each channel's
        // inline spec, so render it immediately instead of holding a spinner
        // through the WS handshake. The WS snapshot replaces it on arrival
        // (and classic channels have no decodable inline spec, so they keep
        // the spinner until the snapshot routes them to the thumb stream).
        if let cached = channels.first(where: { $0.id == channelId })?.spec {
            compiledScene = cached.compile(seed: cached.seed ?? 0)
            specBackground = cached.background
        }

        wsTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in await ws.events(baseURL: baseURL, channelId: channelId) {
                    guard !Task.isCancelled else { break }
                    self.handle(event)
                }
            } catch {
                // Stream ended with an error — the next selectChannel reconnects.
            }
        }
    }

    func exitChannel() {
        wsTask?.cancel()
        wsTask = nil
        Task { await ws.disconnect() }
        selectedChannelId = nil
        overlayText = nil
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

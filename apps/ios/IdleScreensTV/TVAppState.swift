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
    /// Wall-clock of the most recent switch push from a paired phone.
    var phonePushAt: Date?

    // MARK: Gallery

    var channels: [PublicChannel] = []
    /// Editorial shelf catalog, server-ordered.
    var categories: [ChannelCategory] = []
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
    /// Saver id of a classic (non-schema) spec — e.g. "warp". Drives the
    /// native classic renderer when the saver has a port.
    var classicSaverId: String?
    /// Seed for the native classic renderer (channel epoch when present).
    var classicSeed = 0

    /// Minimal probe for classic saver documents: `{"id": "warp"}`.
    private struct ClassicIdProbe: Decodable {
        let id: String?
    }

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

    /// Raw hardware capability, ignoring the per-channel adaptive ladder.
    /// The classic-saver ports gate on THIS: thumbFailed / learned caps are
    /// thumb-stream and schema-scene verdicts, and a broken server thumb
    /// must not veto a fully local renderer.
    var hardwareTier: CapabilityTier {
        tierOverride ?? detectedTier
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
        if categories.isEmpty, let cached = await gallery.cachedCategories() {
            categories = cached
        }
        do {
            channels = try await gallery.fetchChannels()
            galleryError = nil
        } catch {
            // Keep showing cached content on refresh failure; only surface
            // the error when there is nothing to show at all.
            if channels.isEmpty { galleryError = error.localizedDescription }
        }
        // Shelves are enrichment: a failure here just means the grid falls
        // back to id-derived shelf titles, never an error state.
        if let fetched = try? await gallery.fetchCategories() {
            categories = fetched
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
        classicSaverId = nil
        thumbFailed = false
        watchdogDowngraded = false
        complexityCap = nil
        stopSequence()
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
            // Any switch push proves a paired phone is steering this TV —
            // the pairing screen uses it as its "✓ Paired" cue (the phone
            // sends a same-channel ack right after claiming).
            phonePushAt = Date()
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
        guard let data = try? JSONEncoder().encode(json) else { return }
        // Sequence envelope? Route to the timeline player — it carries no
        // top-level layers, so without this check it would misroute to the
        // classic/thumb path (which is why sequence channels used to break).
        if let seq = try? JSONDecoder().decode(SequenceSubset.self, from: data),
           SequenceSubset.isSequenceDocument(format: seq.format),
           !seq.segments.isEmpty {
            isClassicSpec = false
            startSequence(seq, fallbackSeed: fallbackSeed)
            return
        }
        stopSequence()
        guard let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else {
            // Not a schema spec (e.g. classic saver {"id":"warp"}). Savers
            // with a native port render locally; the rest stay on thumbs.
            isClassicSpec = true
            classicSaverId = (try? JSONDecoder().decode(ClassicIdProbe.self, from: data))?.id
            classicSeed = fallbackSeed ?? 0
            compiledScene = []
            specBackground = nil
            return
        }
        // A valid schema spec clears the classic flag (re-publish scenario).
        isClassicSpec = false
        classicSaverId = nil
        let seed = spec.seed ?? fallbackSeed ?? 0
        compiledScene = spec.compile(seed: seed)
        specBackground = spec.background
        complexityCap = SceneComplexity.precap(for: compiledScene)
    }

    // MARK: Sequence playback

    /// The active idle-sequence, when the channel publishes one. Segments
    /// advance on a wall-clock timeline; each segment compiles into the same
    /// compiledScene the tier renderers already draw.
    private(set) var activeSequence: SequenceSubset?
    private var sequenceEpoch: Date?
    private var sequenceTask: Task<Void, Never>?
    /// Key of the on-screen segment — the player crossfades on change.
    private(set) var sequenceSegmentKey: String?
    /// Crossfade duration entering the current segment (0 = hard cut).
    private(set) var sequenceCrossfade: TimeInterval = 0

    private func startSequence(_ seq: SequenceSubset, fallbackSeed: Int?) {
        // WS snapshots repeat the document — restart only on real change.
        guard seq != activeSequence else { return }
        sequenceTask?.cancel()
        activeSequence = seq
        sequenceEpoch = Date()
        applySegment(seq, at: 0, fallbackSeed: fallbackSeed)
        scheduleSequenceAdvance(fallbackSeed: fallbackSeed)
    }

    private func stopSequence() {
        sequenceTask?.cancel()
        sequenceTask = nil
        activeSequence = nil
        sequenceEpoch = nil
        sequenceSegmentKey = nil
        sequenceCrossfade = 0
    }

    private func applySegment(_ seq: SequenceSubset, at T: TimeInterval, fallbackSeed: Int?) {
        let resolved = seq.resolve(at: T)
        let segment = seq.segments[resolved.index]
        sequenceCrossfade = seq.transitionDuration(entering: resolved.index)
        sequenceSegmentKey = segment.key ?? "segment-\(resolved.index)"
        let scene = segment.scene
        let seed = scene.seed ?? seq.seed ?? fallbackSeed ?? 0
        compiledScene = scene.compile(seed: seed)
        specBackground = scene.background
        complexityCap = SceneComplexity.precap(for: compiledScene)
    }

    private func scheduleSequenceAdvance(fallbackSeed: Int?) {
        sequenceTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let seq = self.activeSequence,
                      let epoch = self.sequenceEpoch else { return }
                let now = Date().timeIntervalSince(epoch)
                // A durationless tail with no loop holds forever.
                guard let wait = seq.nextBoundary(after: now) else { return }
                try? await Task.sleep(for: .seconds(wait + 0.02))
                guard !Task.isCancelled else { return }
                self.applySegment(seq, at: Date().timeIntervalSince(epoch),
                                  fallbackSeed: fallbackSeed)
            }
        }
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

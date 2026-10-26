import Foundation
import Observation
import SwiftUI

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
    /// Which surface opened the current channel. Two tabs can each push the
    /// fullscreen player, so the binding has to name one — without this both
    /// stacks present the same destination and backing out lands you on a
    /// screen you never chose.
    var presentingSurface: ChannelSurface = .grid

    enum ChannelSurface { case grid, search }
    var sleeping = false
    var viewers: Int?
    var overlayText: String?
    var currentSpecJSON: JSONValue?
    var compiledScene: [CompiledLayer] = []
    var specBackground: SpecSubset.Background?
    /// 0…1 frame persistence declared by the scene (motion smear).
    var specGhosting: Double = 0
    /// The on-screen scene's render seed (a `field` background and the
    /// `finish` grain hash it) and its print finish — a sequence's own
    /// finish wins over its segment's (FORMAT.md `finish`).
    var specSeed: Int = 0
    var specFinish: SpecSubset.Finish?
    /// True when the channel runs a non-schema spec (e.g. classic saver
    /// `{"id":"warp"}`) — no native render possible, route to the thumb stream.
    var isClassicSpec = false
    /// Saver id of a classic (non-schema) spec — e.g. "warp". Drives the
    /// native classic renderer when the saver has a port.
    var classicSaverId: String?
    /// Steered params from the channel scene's control track (classic scenes
    /// only) — the native aquarium interprets `environment` and `fishMix`.
    var classicParams: [String: String] = [:]
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
    /// How hard this box may be pushed at whatever tier it renders on.
    let renderClass: RenderClass

    /// The gallery on a box that rasterises on its CPU (the sprite tier, or a
    /// pre-4K Apple TV): thinner posters, no second canvas behind each one,
    /// and a flat tint instead of a 90 pt blurred backdrop — remote swipes on
    /// the home screen lagged there.
    var lightweightGallery: Bool { effectiveTier != .t3 || renderClass == .legacy }
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

    /// Compile ceiling for a fullscreen scene on this box.
    var sceneBudget: (layers: Int, entities: Int) {
        (layers: SpecSubset.Budget.fullscreen.layers,
         entities: renderClass.fullscreenEntityBudget)
    }

    /// Raw hardware capability, ignoring the per-channel adaptive ladder.
    /// The classic-saver ports gate on THIS: thumbFailed / learned caps are
    /// thumb-stream and schema-scene verdicts, and a broken server thumb
    /// must not veto a fully local renderer.
    var hardwareTier: CapabilityTier {
        tierOverride ?? detectedTier
    }

    /// Tier to draw a ported classic saver at, or nil when this box should
    /// stay on the thumb stream. Unlike the schema renderer, these savers
    /// only stroke lines, so the pre-4K boxes (t2) get a thinner field at
    /// 30fps rather than nothing. A watchdog downgrade drops them out.
    var classicRenderTier: CapabilityTier? {
        guard !watchdogDowngraded else { return nil }
        let tier = hardwareTier
        return tier == .t3 || tier == .t2 ? tier : nil
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
        self.renderClass = CapabilityDetector.renderClass(forMachine: machine)
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
            mcp: MCPClient(baseURL: baseURL, transport: transport, confirmer: MCPConfirmPrompt.confirmer),
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

    func selectChannel(_ channelId: String, from surface: ChannelSurface = .grid) {
        // Surfing dissolves channel into channel (0.45 s, the selectedChannelId
        // animation): keep the one you're leaving drawing under the next.
        if selectedChannelId != nil, selectedChannelId != channelId {
            beginCrossfade(seconds: renderClass == .legacy ? 0.3 : 0.45)
        } else {
            // Opened from the grid: nothing to dissolve from, and a copy left
            // over from the last visit must not draw over this channel.
            endCrossfade()
        }
        rendererMountedAt = Date()
        bedMountedAt = rendererMountedAt
        presentingSurface = surface
        selectedChannelId = channelId
        sleeping = false
        viewers = nil
        overlayText = nil
        currentSpecJSON = nil
        compiledScene = []
        specBackground = nil
        specGhosting = 0
        specFinish = nil
        isClassicSpec = false
        classicSaverId = nil
        thumbFailed = false
        watchdogDowngraded = false
        complexityCap = nil
        stopSequence()
        stopKeyframes()
        resetTimeline()
        scheduleRotation()
        UserDefaults.standard.set(channelId, forKey: Self.lastChannelKey)
        // Instant first frame: the gallery payload carries each channel's
        // inline spec, so render it immediately instead of holding a spinner
        // through the WS handshake. The WS snapshot replaces it on arrival
        // (and classic channels have no decodable inline spec, so they keep
        // the spinner until the snapshot routes them to the thumb stream).
        if let cached = channels.first(where: { $0.id == channelId })?.spec {
            compiledScene = cached.compile(seed: cached.seed ?? 42, budget: sceneBudget)
            setGround(cached, seed: cached.seed ?? 42)
            complexityCap = SceneComplexity.precap(for: compiledScene, renderClass: renderClass)
        }
        openSocket(channelId: channelId, watching: true)
    }

    // MARK: Channel surfing

    /// The channel `step` places along the feed from `current`, wrapping at
    /// both ends — Up/Down on the remote, the oldest convention a TV has.
    ///
    /// Order is the iPhone feed's (`ChannelFeed.latestFirst`), so the two
    /// devices flip through the same channels in the same order. Sleeping
    /// channels are skipped: when you are surfing, a moon and a sentence is a
    /// dud page. The current channel is kept in the ring even if it sleeps,
    /// so there is always somewhere to step FROM.
    static func surfTarget(from current: String?, step: Int,
                           in channels: [PublicChannel]) -> String? {
        let ring = ChannelFeed.latestFirst(channels)
            .filter { $0.sleeping != true || $0.id == current }
        guard ring.count > 1, step != 0 else { return nil }
        guard let current, let i = ring.firstIndex(where: { $0.id == current }) else {
            return ring.first?.id
        }
        let n = ring.count
        return ring[((i + step) % n + n) % n].id
    }

    /// Where the current channel sits in the surf ring, for "3 of 61".
    var surfPosition: (index: Int, count: Int)? {
        let ring = ChannelFeed.latestFirst(channels)
            .filter { $0.sleeping != true || $0.id == selectedChannelId }
        guard let i = ring.firstIndex(where: { $0.id == selectedChannelId }) else { return nil }
        return (i + 1, ring.count)
    }

    func surf(_ step: Int) {
        guard let next = Self.surfTarget(from: selectedChannelId, step: step, in: channels)
        else { return }
        // Stay on whichever surface opened the player, so Back still returns there.
        selectChannel(next, from: presentingSurface)
    }

    // MARK: Timeline — the channel's past (Left / Right)

    /// Where the player is on the current channel's timeline.
    enum Timeline: Equatable {
        case live
        /// Index into `historyStops`, 0 = the scene before the live one.
        case past(Int)
        /// A stored scene a paired phone sent, not (yet) placed among the
        /// loaded `historyStops`.
        case pinned(sceneId: Int)
    }

    private(set) var timeline: Timeline = .live
    /// Past scenes of the current channel, newest first (the live one dropped).
    private(set) var historyStops: [ChannelFeed.Stop] = []
    /// The scene on screen when `timeline` is `.past`.
    private(set) var pastScene: RecordedScene?
    private var liveScene: (json: JSONValue, seed: Int?)?
    private var liveClassicParams: [String: String] = [:]
    private var historyTask: Task<Void, Never>?

    /// One step along the timeline. Left goes older and stops at the oldest
    /// known scene; Right comes back toward live and stops there. Pure, so
    /// the edges are testable: the remote must never wrap from the oldest
    /// scene back to live, or "keep pressing left" becomes a loop.
    static func timelineStep(from current: Timeline, older: Bool, stops: Int) -> Timeline {
        switch (current, older) {
        case (.live, true): return stops > 0 ? .past(0) : .live
        case (.live, false): return .live
        case (.past(let i), true): return .past(Swift.min(i + 1, Swift.max(0, stops - 1)))
        case (.past(let i), false): return i <= 0 ? .live : .past(i - 1)
        // From a scene the phone sent: Left starts the history, Right is live.
        case (.pinned, true): return stops > 0 ? .past(0) : .live
        case (.pinned, false): return .live
        }
    }

    /// Show one stored scene of the current channel, as a paired phone asked.
    /// Placed on the remote's timeline when the loaded history already holds
    /// it, so Left/Right step on from there.
    func pinScene(_ sceneId: Int) {
        guard let channelId = selectedChannelId else { return }
        historyTask?.cancel()
        historyTask = Task { [weak self] in
            guard let self,
                  let scene = try? await self.gallery.fetchScene(channelId: channelId, sceneId: sceneId),
                  !Task.isCancelled, self.selectedChannelId == channelId else { return }
            self.timeline = self.historyStops.firstIndex { $0.sceneId == sceneId }
                .map { .past($0) } ?? .pinned(sceneId: sceneId)
            self.pastScene = scene
            self.show(scene)
        }
    }

    /// Step into the past (or back). The first step fetches the channel's
    /// history; every scene is fetched once and rendered by the same native
    /// renderers as live — the format is deterministic, so a past scene is
    /// reproduced, not replayed from a recording.
    func stepTimeline(older: Bool) {
        guard let channelId = selectedChannelId else { return }
        historyTask?.cancel()
        historyTask = Task { [weak self] in
            guard let self else { return }
            if older, self.historyEvents.isEmpty || self.atOldestLoadedStop, self.historyHasMore {
                // First Left fetches a page; reaching its oldest stop fetches
                // the next, so the past keeps going instead of hitting a wall
                // at one page (the phone pages the same way).
                guard let page = try? await self.gallery.fetchHistoryPage(
                    channelId: channelId, limit: 40, before: self.historyEvents.map(\.id).min()),
                      !Task.isCancelled, self.selectedChannelId == channelId else { return }
                self.historyEvents += page.events
                self.historyHasMore = (page.hasMore ?? false) && !page.events.isEmpty
                self.historyStops = ChannelFeed.stops(from: self.historyEvents, limit: nil)
            }
            let target = Self.timelineStep(from: self.timeline, older: older,
                                           stops: self.historyStops.count)
            guard target != self.timeline else { return }
            switch target {
            case .live:
                self.returnToLive()
            case .past(let i):
                let stop = self.historyStops[i]
                guard let scene = try? await self.gallery.fetchScene(
                    channelId: channelId, sceneId: stop.sceneId),
                      !Task.isCancelled, self.selectedChannelId == channelId else { return }
                self.timeline = target
                self.pastScene = scene
                self.show(scene)
            case .pinned:
                break   // only a phone's push pins; stepping never lands here
            }
        }
    }

    func returnToLive() {
        guard timeline != .live else { return }
        timeline = .live
        pastScene = nil
        classicParams = liveClassicParams
        if let live = liveScene { render(live.json, fallbackSeed: live.seed) }
    }

    /// Every event fetched so far, newest pages first, and whether the server
    /// has older ones.
    private var historyEvents: [ChannelEvent] = []
    private var historyHasMore = true

    private var atOldestLoadedStop: Bool {
        if case .past(let i) = timeline { return i >= historyStops.count - 1 }
        return historyStops.isEmpty
    }

    private func resetTimeline() {
        historyTask?.cancel()
        timeline = .live
        historyStops = []
        historyEvents = []
        historyHasMore = true
        pastScene = nil
        liveScene = nil
        liveClassicParams = [:]
    }

    private func show(_ scene: RecordedScene) {
        stopSequence()
        stopKeyframes()
        if let spec = scene.spec {
            isClassicSpec = false
            classicSaverId = nil
            let seed = spec.seed ?? scene.seed ?? 42
            compiledScene = spec.compile(seed: seed, budget: sceneBudget)
            setGround(spec, seed: seed)
            complexityCap = SceneComplexity.precap(for: compiledScene, renderClass: renderClass)
            // A timed piece in the past plays its keyframes too, not its base.
            if let raw = scene.rawSpec { startKeyframes(raw, seed: seed) }
        } else {
            isClassicSpec = true
            classicSaverId = scene.classicSaverId
            // The live scene's steering does not belong to a past one.
            classicParams = [:]
            classicSeed = ClassicSaverKind.seed(forChannel: selectedChannelId ?? "")
            compiledScene = []
            setGround(nil, seed: 0)
        }
    }

    // MARK: Auto-rotate — an ambient display that changes on its own

    static let rotateMinutesKey = "tv.rotate_minutes"
    static let resumeOnLaunchKey = "tv.resume_on_launch"

    /// Minutes between automatic channel changes; 0 = off.
    var rotateMinutes: Int = UserDefaults.standard.integer(forKey: TVAppState.rotateMinutesKey) {
        didSet {
            UserDefaults.standard.set(rotateMinutes, forKey: Self.rotateMinutesKey)
            scheduleRotation()
        }
    }

    /// Reopen the last channel at launch instead of landing on the grid.
    var resumeOnLaunch: Bool = UserDefaults.standard.bool(forKey: TVAppState.resumeOnLaunchKey) {
        didSet { UserDefaults.standard.set(resumeOnLaunch, forKey: Self.resumeOnLaunchKey) }
    }

    /// The channel to reopen at launch, if the viewer asked for that and there
    /// is one. nil on a first run — "default" is a socket fallback, not
    /// somewhere the viewer chose to be.
    var resumeChannelId: String? {
        guard resumeOnLaunch else { return nil }
        return UserDefaults.standard.string(forKey: Self.lastChannelKey)
    }

    private var rotationTask: Task<Void, Never>?

    /// Rotation only fires on a live, selected channel. Someone who stepped
    /// into a channel's past is looking at something on purpose; rotating
    /// them away from it would be the app interrupting its own viewer.
    static func shouldRotate(minutes: Int, selected: String?, timeline: Timeline) -> Bool {
        minutes > 0 && selected != nil && timeline == .live
    }

    /// Re-armed on every channel change, so the interval always counts from
    /// when THIS channel came up — surfing by hand resets the clock.
    private func scheduleRotation() {
        rotationTask?.cancel()
        guard rotateMinutes > 0 else { return }
        let interval = Double(rotateMinutes) * 60
        rotationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(interval))
            guard !Task.isCancelled, let self else { return }
            if Self.shouldRotate(minutes: self.rotateMinutes,
                                 selected: self.selectedChannelId,
                                 timeline: self.timeline) {
                self.surf(1)          // selectChannel re-arms the timer
            } else {
                self.scheduleRotation()
            }
        }
    }

    func exitChannel() {
        endCrossfade()
        selectedChannelId = nil
        overlayText = nil
        stopKeyframes()
        resetTimeline()
        rotationTask?.cancel()
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
                    } else if case .switchChannel(let target, let scene) = event {
                        self.handle(.switchChannel(channelId: target, sceneId: scene))
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
            // The scene object carries the control track; resolvedSpec is the
            // bare saver ref. Harvest steered params BEFORE routing so a
            // classic scene's environment/fishMix reach the native renderer.
            // Live steering is kept apart from what is on screen, so a
            // snapshot arriving while the viewer is in the past neither
            // restyles the past scene nor gets lost for the return.
            liveClassicParams = Self.trackParams(from: snapshot.scene)
            if timeline == .live { classicParams = liveClassicParams }
            if let epoch = snapshot.epoch { channelEpochMs = epoch }
            if let now = snapshot.now { serverSkew = Double(now) / 1000 - Date().timeIntervalSince1970 }
            // The web seeds a scene with the spec's seed, else the scene's, else 42.
            let sceneSeed: Int? = { if case .object(let o)? = snapshot.scene { return o["seed"]?.intValue } else { return nil } }()
            let track: JSONValue? = { if case .object(let o)? = snapshot.scene { return o["track"] } else { return nil } }()
            if let base = Self.publishMount(snapshot.scene, track: track) {
                // A publish's own glide plays from this screen's mount (F85).
                applySpec(base, fallbackSeed: sceneSeed ?? 42)
                if timeline == .live { applyLiveTrack(track) }
            } else if let spec = snapshot.resolvedSpec ?? snapshot.scene ?? snapshot.spec {
                applySpec(spec, fallbackSeed: sceneSeed ?? 42)
            }
        case .reseed(let seed, let epoch):
            if let epoch { channelEpochMs = epoch }
            // Browsing the past: the live scene it returns to takes the new seed.
            if timeline != .live, let live = liveScene { liveScene = (live.json, seed ?? 42); break }
            guard let json = currentSpecJSON else { break }
            // A new arrangement: the steered scene remounts on the new seed.
            let shown = steeredJSON ?? json
            stopSteer(); stopKeyframes(); stopSequence()
            steeredJSON = nil; steerShown = nil; currentSpecJSON = nil
            sceneRevision &+= 1
            render(shown, fallbackSeed: seed ?? 42)
        case .scene(let spec, let seed, let transition, let epoch, let track):
            if let epoch { channelEpochMs = epoch }
            if let spec {
                // A publish replaces the scene, and the steers made on the old one.
                if timeline == .live {
                    stopSteer()
                    steeredJSON = nil
                    steerShown = nil
                    currentSpecJSON = nil
                }
                // A new scene on the channel: the renderer identity changes, so
                // the player dissolves old into new instead of swapping layers
                // in place at the old clock (a hard cut).
                if timeline == .live {
                    sceneCrossfade = Self.crossfadeSeconds(transition, renderClass: renderClass)
                    beginCrossfade(seconds: sceneCrossfade)
                    sceneRevision &+= 1
                }
                // Kept and recalled steers are in force from the first frame;
                // a publish's own glide (`fromPublish`) plays from here.
                let mount = Self.mountDeltas(track).map { SpecTimeline.applyDeltas(spec, $0) } ?? spec
                applySpec(mount, fallbackSeed: seed ?? 42)
                if timeline == .live, track != nil { applyLiveTrack(track) }
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
        case .track(let track, _):
            applyLiveTrack(track)
        case .switchChannel(let channelId, let sceneId):
            // Any switch push proves a paired phone is steering this TV —
            // the pairing screen uses it as its "✓ Paired" cue (the phone
            // sends a same-channel ack right after claiming).
            phonePushAt = Date()
            guard let channelId, !channelId.isEmpty else { break }
            if channelId != selectedChannelId {
                selectChannel(channelId, from: .grid)
                // After the switch: selecting resets the timeline.
                if let sceneId { pinScene(sceneId) }
            } else if let sceneId {
                pinScene(sceneId)
            } else {
                // Same channel, no scene: the phone wants it live (sync mode
                // following the phone back to live, or "send live").
                returnToLive()
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

    /// Flatten a classic scene's track into last-write-wins string params.
    /// Only t=0 "set" deltas matter here — the TV interprets the scene's
    /// standing state, not its glide timing.
    static func trackParams(from scene: JSONValue?) -> [String: String] {
        guard case .object(let obj)? = scene,
              case .object(let track)? = obj["track"],
              case .array(let deltas)? = track["deltas"] else { return [:] }
        var out: [String: String] = [:]
        for delta in deltas {
            guard case .object(let d) = delta,
                  case .string(let path)? = d["path"] else { continue }
            switch d["value"] {
            case .string(let v): out[path] = v
            case .int(let v): out[path] = String(v)
            case .double(let v): out[path] = v == v.rounded() ? String(Int(v)) : String(v)
            case .bool(let v): out[path] = String(v)
            default: break
            }
        }
        return out
    }

    private func applySpec(_ json: JSONValue, fallbackSeed: Int?) {
        // The channel keeps living while someone is looking at its past: keep
        // the newest live scene on hand, but don't yank the viewer out of the
        // scene they deliberately stepped back to.
        liveScene = (json, fallbackSeed)
        guard timeline == .live else { return }
        render(json, fallbackSeed: fallbackSeed)
    }

    private func render(_ json: JSONValue, fallbackSeed: Int?) {
        sceneClockOffset = 0
        // A new document replaces whatever the steers had made of the old one.
        if json != currentSpecJSON {
            stopSteer()
            steeredJSON = nil
            steerShown = nil
        }
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
            stopKeyframes()
            // Not a schema spec (e.g. classic saver {"id":"warp"}). Savers
            // with a native port render locally; the rest stay on thumbs.
            isClassicSpec = true
            classicSaverId = (try? JSONDecoder().decode(ClassicIdProbe.self, from: data))?.id
            // Seed from the channel id, not the publish epoch: the field
            // survives re-publishes and matches the grid poster exactly.
            classicSeed = ClassicSaverKind.seed(forChannel: selectedChannelId ?? "")
            compiledScene = []
            setGround(nil, seed: 0)
            return
        }
        // A valid schema spec clears the classic flag (re-publish scenario).
        isClassicSpec = false
        classicSaverId = nil
        let seed = spec.seed ?? fallbackSeed ?? 0
        // Snapshots repeat the document. A timed scene already being driven
        // keeps its clock and its current frame: recompiling the base here
        // would flash the un-keyed scene, and restarting would rewind it.
        liveSeed = seed
        if isDrivingKeyframes(json, seed: seed) { return }
        if steeredJSON != nil { return }   // a steered scene keeps its steers on a repeat
        compiledScene = spec.compile(seed: seed, budget: sceneBudget)
        setGround(spec, seed: seed)
        complexityCap = SceneComplexity.precap(for: compiledScene, renderClass: renderClass)
        startKeyframes(json, seed: seed)
    }

    // MARK: Sequence playback

    /// The active idle-sequence, when the channel publishes one. Segments
    /// advance on a wall-clock timeline; each segment compiles into the same
    /// compiledScene the tier renderers already draw.
    private(set) var activeSequence: SequenceSubset?
    private var sequenceEpoch: Date?
    private var sequenceTask: Task<Void, Never>?
    /// Bumps on every live scene message (publish, recall, scheduled entry):
    /// part of the renderer identity, so a new scene dissolves in.
    private(set) var sceneRevision = 0
    /// How long that dissolve takes (0 = a cut).
    private(set) var sceneCrossfade: TimeInterval = SceneTransition.defaultSeconds

    /// The scene being replaced, still drawing (and animating) UNDER the
    /// incoming one until the dissolve ends. A renderer SwiftUI is removing
    /// stops drawing at once, so a plain `.transition(.opacity)` dissolved
    /// through black (measured on the simulator: the old scene went to black
    /// in one frame, the new one rose from it). Native tiers only.
    struct OutgoingScene {
        let id: Int
        let layers: [CompiledLayer]
        let background: SpecSubset.Background?
        let ghosting: Double
        let seed: Int
        /// Seconds it had been running, so the copy carries on from there.
        let elapsed: TimeInterval
        /// Drawn over a bed, so see-through, as the live renderer paints it.
        let transparent: Bool
        /// The bed itself, kept only when the whole sequence is being replaced
        /// (within one sequence the live bed carries on underneath).
        let bed: Bed?

        struct Bed {
            let layers: [CompiledLayer]
            let background: SpecSubset.Background?
            let ghosting: Double
            let seed: Int
            let elapsed: TimeInterval
        }
    }
    private(set) var outgoing: OutgoingScene?
    private(set) var outgoingOpacity: Double = 1
    private var outgoingTask: Task<Void, Never>?
    private var outgoingSerial = 0
    /// When the on-screen scene renderer, and the bed under it, last mounted:
    /// their clocks start there.
    private var rendererMountedAt = Date()
    private var bedMountedAt = Date()

    private func endCrossfade() {
        outgoingTask?.cancel()
        outgoingTask = nil
        outgoing = nil
    }

    /// Keep what is on screen drawing under whatever replaces it, for `seconds`.
    private func beginCrossfade(seconds: TimeInterval, withBed: Bool = true) {
        endCrossfade()
        let now = Date()
        // Whatever replaces this scene mounts a fresh renderer: its clock starts now.
        defer { rendererMountedAt = now }
        guard seconds > 0, !compiledScene.isEmpty, !isClassicSpec,
              effectiveTier == .t3 || effectiveTier == .t2 else { return }
        outgoingSerial &+= 1
        let bed = hasBed && withBed ? OutgoingScene.Bed(layers: bedScene, background: bedBackground, ghosting: bedGhosting,
                                            seed: bedSeed, elapsed: now.timeIntervalSince(bedMountedAt)) : nil
        outgoing = OutgoingScene(id: outgoingSerial, layers: compiledScene, background: specBackground,
                                 ghosting: specGhosting, seed: specSeed, elapsed: now.timeIntervalSince(rendererMountedAt) + sceneClockOffset,
                                 transparent: hasBed, bed: bed)
        outgoingOpacity = 1
        let serial = outgoingSerial
        outgoingTask = Task { @MainActor [weak self] in
            // Opaque and replaced by an opaque scene, the copy holds at full
            // opacity under it: a true crossfade. When the incoming scene is
            // see-through (over a bed) it must fade out too, or it would pop
            // off at the end. The incoming state is settled by now.
            if self?.hasBed == true {
                try? await Task.sleep(for: .milliseconds(30))
                guard !Task.isCancelled else { return }
                withAnimation(.easeInOut(duration: seconds)) { self?.outgoingOpacity = 0 }
            }
            try? await Task.sleep(for: .seconds(seconds + 0.15))
            guard !Task.isCancelled, self?.outgoingSerial == serial else { return }
            self?.outgoing = nil
        }
    }

    /// Two renderers are alive while one dissolves into the other: keep it
    /// short on the oldest hardware we support.
    nonisolated static func crossfadeSeconds(_ transition: SceneTransition?, renderClass: RenderClass) -> TimeInterval {
        let want = SceneTransition.seconds(for: transition)
        return renderClass == .legacy ? min(want, 0.4) : want
    }

    /// Key of the on-screen segment — the player crossfades on change.
    private(set) var sequenceSegmentKey: String?
    /// Crossfade duration entering the current segment (0 = hard cut).
    private(set) var sequenceCrossfade: TimeInterval = 0
    /// The sequence's bed, compiled once: drawn under every segment on its
    /// own clock, which never resets at a segment boundary. Empty = no bed.
    private(set) var bedScene: [CompiledLayer] = []
    private(set) var bedBackground: SpecSubset.Background?
    private(set) var bedGhosting: Double = 0
    private(set) var bedSeed: Int = 0
    /// Seconds the on-screen scene's own clock had run when its renderer
    /// mounted (a segment entered mid-way), and the bed's.
    private(set) var sceneClockOffset: TimeInterval = 0
    private(set) var bedClockOffset: TimeInterval = 0
    /// The grain seed: a sequence-level finish keeps the sequence's seed
    /// across segments (compile.ts `frameFinishSeed`).
    private(set) var finishSeed: Int = 0
    /// The live scene's publish time (ms), the origin of the channel's shared
    /// clock — what `sync: 'epoch'` sequences anchor to.
    private(set) var channelEpochMs: Int?
    /// Server clock − device clock (s), from the snapshot's `now`.
    private var serverSkew: TimeInterval = 0
    /// True while the active sequence has a bed (even one with no layers —
    /// its ground alone still replaces every segment's background).
    private(set) var hasBed = false

    private func startSequence(_ seq: SequenceSubset, fallbackSeed: Int?) {
        // WS snapshots repeat the document — restart only on real change.
        guard seq != activeSequence else { return }
        sequenceTask?.cancel()
        activeSequence = seq
        // `sync: 'epoch'` starts the clock where the channel's shared clock
        // is (every screen in the room on one segment); `mount` at 0.
        let baseT = Self.sequenceBaseT(seq, epochMs: channelEpochMs, now: Date().addingTimeInterval(serverSkew))
        sequenceEpoch = Date().addingTimeInterval(-baseT)
        if let bed = seq.bed {
            bedSeed = seq.bedSeed(fallback: fallbackSeed ?? 42)
            bedClockOffset = baseT
            bedScene = bed.compile(seed: bedSeed, budget: sceneBudget)
            bedBackground = bed.background
            bedGhosting = bed.ghosting ?? 0
            if !hasBed { bedMountedAt = sequenceEpoch ?? Date() }
            hasBed = true
        } else {
            clearBed()
        }
        applySegment(seq, at: baseT, fallbackSeed: fallbackSeed, advancing: false)
        scheduleSequenceAdvance(fallbackSeed: fallbackSeed)
    }

    /// Seconds already elapsed on a `sync: 'epoch'` sequence's shared clock
    /// (the site's `sequenceBaseT`): `now − epoch`, wrapped into the lap when
    /// it loops, never negative; 0 for `mount` or without an epoch.
    nonisolated static func sequenceBaseT(_ seq: SequenceSubset, epochMs: Int?, now: Date) -> TimeInterval {
        guard seq.sync == "epoch", let epochMs else { return 0 }
        var elapsed = max(0, now.timeIntervalSince1970 - Double(epochMs) / 1000)
        if seq.loop == true {
            var lap: TimeInterval = 0
            for seg in seq.segments { guard let d = seg.duration else { break }; lap += d / 1000 }
            if lap > 0 { elapsed = elapsed.truncatingRemainder(dividingBy: lap) }
        }
        return elapsed
    }

    private func stopSequence() {
        sequenceTask?.cancel()
        sequenceTask = nil
        stopMorph()
        activeSequence = nil
        sequenceEpoch = nil
        sequenceSegmentKey = nil
        sequenceCrossfade = 0
        sequenceWipe = nil
        clearBed()
    }

    private func clearBed() {
        bedScene = []
        bedBackground = nil
        bedGhosting = 0
        hasBed = false
    }

    /// The wipe in flight entering the current segment, if that is how it
    /// arrived (nil for every other crossing).
    private(set) var sequenceWipe: SequenceSubset.Wipe?
    /// When that wipe began and how long it runs (the authored `dur`).
    private(set) var sequenceWipeStart = Date()
    private(set) var sequenceWipeDuration: TimeInterval = 0

    /// `advancing` is a step to the next segment of the sequence already on
    /// screen; the first segment of a new sequence is dissolved in by the scene
    /// message (or the channel change) that started it.
    private func applySegment(_ seq: SequenceSubset, at T: TimeInterval, fallbackSeed: Int?,
                              advancing: Bool = true) {
        stopKeyframes()
        stopMorph()
        let resolved = seq.resolve(at: T)
        let index = resolved.index
        let segment = seq.segments[index]
        // The crossing is the OUTGOING segment's transition (web parity).
        let crossing = seq.crossing(into: index, wrapped: index == 0 && seq.hasWrapped(at: T))
        var dissolve: TimeInterval = 0
        var wipe: SequenceSubset.Wipe?
        switch crossing {
        case .fade(let seconds): dissolve = seconds
        case .wipe(let w, let seconds): dissolve = seconds; wipe = w
        case .cut, .morph: break
        }
        // Two renderers overlap during a dissolve: same cap as a scene message.
        let remaining = max(0, dissolve - resolved.localT)
        sequenceCrossfade = renderClass == .legacy ? min(remaining, 0.4) : remaining
        sequenceWipe = remaining > 0 ? wipe : nil
        sequenceWipeStart = Date().addingTimeInterval(-resolved.localT)
        sequenceWipeDuration = renderClass == .legacy ? min(dissolve, 0.4) : dissolve
        if sequenceWipe != nil {
            // Done sweeping: drop the mask so it stops animating.
            let key = segment.key ?? "segment-\(index)"
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(remaining + 0.2))
                if self?.sequenceSegmentKey == key { self?.sequenceWipe = nil }
            }
        }
        let nextKey = segment.key ?? "segment-\(index)"
        if advancing, sequenceSegmentKey != nil, sequenceSegmentKey != nextKey, sequenceCrossfade > 0 {
            beginCrossfade(seconds: sequenceCrossfade, withBed: false)
        }
        sequenceSegmentKey = nextKey
        // Entities render with the morph chain root's seed (sequence.ts
        // `segmentRenderSeed`), so a chain of twins never re-seats.
        let seed = seq.renderSeed(index, fallback: fallbackSeed ?? 0)
        let scene = segment.scene
        let entered = Date().addingTimeInterval(-resolved.localT)
        // Entered mid-segment (an epoch joiner, a reconnect): the renderer's
        // clock starts at the segment's local time, as the web's child does.
        sceneClockOffset = resolved.localT
        if case .morph(let from, let seconds, let text) = crossing, resolved.localT < seconds,
           seq.rawScenes.indices.contains(from), seq.rawScenes.indices.contains(index) {
            setGround(scene, seed: seed)
            if hasBed { specBackground = nil; specGhosting = 0 }
            specFinish = seq.finish ?? scene.finish
            if seq.finish != nil { finishSeed = seq.seed ?? fallbackSeed ?? 42 }
            startMorph(seq, from: from, into: index, seconds: seconds, text: text, seed: seed, entered: entered)
            complexityCap = SceneComplexity.precap(for: compiledScene + bedScene, renderClass: renderClass)
            return
        }
        compiledScene = scene.compile(seed: seed, budget: sceneBudget)
        // Over a bed, a segment paints transparently: the bed owns the
        // ground, and a smear needs an opaque ground to decay into.
        setGround(scene, seed: seed)
        if hasBed { specBackground = nil; specGhosting = 0 }
        specFinish = seq.finish ?? scene.finish
        if seq.finish != nil { finishSeed = seq.seed ?? fallbackSeed ?? 42 }
        complexityCap = SceneComplexity.precap(for: compiledScene + bedScene, renderClass: renderClass)
        // A segment's own keyframes run on its local clock (from 0 at entry).
        if seq.rawScenes.indices.contains(index) {
            startKeyframes(seq.rawScenes[index], seed: seed, epoch: entered)
        }
    }

    // MARK: Morph — a lerp between structural twins

    private var morphTask: Task<Void, Never>?

    private func stopMorph() {
        morphTask?.cancel()
        morphTask = nil
    }

    /// Drive a morph into `index` (compile.ts SequenceInstance): each tick the
    /// outgoing scene (resolved on its own clock, `duration + localT`) and
    /// the incoming one (at `localT`) are lerped at `easeSmooth(localT / dur)`
    /// and compiled with the chain root's seed, so every entity keeps its
    /// place; `text: crossfade | dip` paints differing words twice. When the
    /// window closes the incoming segment takes over, keyframes and all.
    private func startMorph(_ seq: SequenceSubset, from: Int, into index: Int, seconds: TimeInterval,
                            text: String, seed: Int, entered: Date) {
        let outDur = (seq.segments[from].duration ?? 0) / 1000
        let rawA = seq.rawScenes[from], rawB = seq.rawScenes[index]
        let twoPass = text == "crossfade" || text == "dip"
        let frame = { [weak self] (localT: TimeInterval) -> Bool in
            guard let self else { return false }
            let k = SpecTimeline.easeSmooth(localT / seconds)
            let a = SpecTimeline.resolve(rawA, at: (outDur + localT) * 1000)
            let b = SpecTimeline.resolve(rawB, at: localT * 1000)
            let lerped = SpecTimeline.lerpSpec(SpecTimeline.withoutTimeline(a), SpecTimeline.withoutTimeline(b), k)
            guard let data = try? JSONEncoder().encode(lerped),
                  let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else { return false }
            var layers = spec.compile(seed: seed, budget: self.sceneBudget)
            // The ground glides with the foreground (a bed owns it otherwise).
            if !self.hasBed { self.specBackground = spec.background }
            if twoPass { MorphText.applyCrossfade(&layers, from: a, to: b, lerped: lerped, k: k, dip: text == "dip") }
            self.compiledScene = layers
            return true
        }
        _ = frame(Date().timeIntervalSince(entered))
        morphTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let localT = Date().timeIntervalSince(entered)
                if localT >= seconds {
                    // The window closed: the incoming segment, on its own clock.
                    self.compiledScene = seq.segments[index].scene.compile(seed: seed, budget: self.sceneBudget)
                    self.morphTask = nil
                    self.startKeyframes(rawB, seed: seed, epoch: entered)
                    return
                }
                guard frame(localT) else { return }
                try? await Task.sleep(for: .seconds(self.keyframeInterval))
            }
        }
    }

    /// A raw scene compiled the way a decoded one is; nil when it no longer decodes.
    nonisolated static func compileJSON(_ json: JSONValue, seed: Int,
                                        budget: (layers: Int, entities: Int)) -> [CompiledLayer]? {
        guard let data = try? JSONEncoder().encode(json),
              let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else { return nil }
        return spec.compile(seed: seed, budget: budget)
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

    /// The deltas a scene MOUNTS with (live-track.ts `mountDeltas`): every
    /// delta but a publish's own (`fromPublish`), which glides in after.
    nonisolated static func mountDeltas(_ track: JSONValue?) -> [(path: String, value: JSONValue)]? {
        guard case .object(let t)? = track, let raw = t["deltas"]?.array, !raw.isEmpty else { return nil }
        return raw.compactMap { item in
            guard case .object(let d) = item, let path = d["path"]?.string, let value = d["value"],
                  d["fromPublish"] != .bool(true) else { return nil }
            return (path, value)
        }
    }

    /// A snapshot whose track still carries a publish's glide mounts at the
    /// spec plus the other deltas, not at the resolved end state; nil otherwise.
    nonisolated static func publishMount(_ scene: JSONValue?, track: JSONValue?) -> JSONValue? {
        guard case .object(let s)? = scene, let spec = s["spec"]?.normalizedSpec(),
              case .object(let root) = spec, root["layers"] != nil,
              case .object(let t)? = track, let raw = t["deltas"]?.array,
              raw.contains(where: { if case .object(let d) = $0 { return d["fromPublish"] == .bool(true) } else { return false } }),
              let mount = mountDeltas(track) else { return nil }
        return SpecTimeline.applyDeltas(spec, mount)
    }

    // MARK: Live steering (`track`)

    /// The live scene as steering has left it (JSON), and the frame on screen
    /// while a glide runs toward it. Nil until the first steer.
    private var steeredJSON: JSONValue?
    private var steerShown: JSONValue?
    private var steerTask: Task<Void, Never>?
    private var liveSeed = 0

    private func stopSteer() {
        steerTask?.cancel()
        steerTask = nil
    }

    /// A steer reached the channel (compile.ts `applyTrack`): the whole track's
    /// deltas applied to what is on screen, glided to over the longest delta's
    /// `dur` with the ease of that delta when it is a steer ease (`in` / `out`
    /// / `spring`), else smooth. A timeline scene takes the steer into its
    /// base and keeps its clock. Sequences and classic savers steer elsewhere.
    func applyLiveTrack(_ track: JSONValue?) {
        if isClassicSpec {
            liveClassicParams = Self.trackParams(from: track.map { .object(["track": $0]) })
            if timeline == .live { classicParams = liveClassicParams }
            return
        }
        guard timeline == .live, activeSequence == nil, let base = steeredJSON ?? currentSpecJSON,
              case .object(let t)? = track, let raw = t["deltas"]?.array else { return }
        if SpecTimeline.hasTimeline(base) { armTimelineSteers(raw, on: base); return }
        var deltas: [(path: String, value: JSONValue)] = []
        var glide = 0.0, ease: String?
        for item in raw {
            guard case .object(let d) = item, let path = d["path"]?.string, let value = d["value"] else { continue }
            deltas.append((path, value))
            let dur = d["dur"]?.number ?? 1000
            if dur > glide || deltas.count == 1 {
                glide = max(glide, dur)
                ease = d["ease"]?.string.flatMap { SpecTimeline.steerEases.contains($0) ? $0 : nil }
            }
        }
        guard !deltas.isEmpty else { return }
        let target = SpecTimeline.applyDeltas(base, deltas)
        guard target != base else { return }
        steeredJSON = target
        let seed = liveSeed
        stopSteer()
        let from = steerShown ?? base
        let began = Date()
        let frame = { [weak self] (k: Double) -> Bool in
            guard let self else { return false }
            let shown = k >= 1 ? target : SpecTimeline.lerpSpec(from, target, SpecTimeline.easeGlide(ease, k))
            guard let data = try? JSONEncoder().encode(shown),
                  let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else { return false }
            self.steerShown = shown
            self.compiledScene = spec.compile(seed: seed, budget: self.sceneBudget)
            self.setGround(spec, seed: seed)
            return true
        }
        guard glide > 0 else { _ = frame(1); return }
        _ = frame(0)
        steerTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let k = Date().timeIntervalSince(began) * 1000 / glide
                guard frame(min(1, k)), k < 1 else { self.steerTask = nil; return }
                try? await Task.sleep(for: .seconds(self.keyframeInterval))
            }
        }
    }

    /// Steers on a timeline scene follow the steering rule (compile.ts
    /// `overrideAuthored`): one steer per field (the last delta for it), each
    /// armed once — a re-sent track does not re-arm a hold the timeline has
    /// already taken back — gliding in from the value on screen.
    private func armTimelineSteers(_ raw: [JSONValue], on authored: JSONValue) {
        guard let epoch = keyframeEpoch else { return }
        let now = Date().timeIntervalSince(epoch) * 1000
        let shown = keyframeShown ?? authored
        var latest: [(path: String, id: String, value: JSONValue, dur: Double, ease: String?)] = []
        for item in raw {
            guard case .object(let d) = item, let p = d["path"]?.string, let value = d["value"],
                  let path = SpecTimeline.canonicalPath(SpecTimeline.withoutTimeline(authored), p) else { continue }
            latest.removeAll { $0.path == path }
            let id = "\(d["t"]?.number ?? 0)|\((try? String(data: JSONEncoder().encode(value), encoding: .utf8)) ?? "")"
            latest.append((path, id, value, d["dur"]?.number ?? 1000,
                           d["ease"]?.string.flatMap { SpecTimeline.steerEases.contains($0) ? $0 : nil }))
        }
        // The batch glides on one curve, the longest delta's.
        let glide = latest.map(\.dur).max() ?? 1000
        let batchEase = latest.first { $0.dur == glide }?.ease
        for s in latest where seenSteers[s.path] != s.id {
            seenSteers[s.path] = s.id
            keyframeOverrides[s.path] = SpecTimeline.Override(
                spec: authored, path: s.path, from: glide > 0 ? SpecTimeline.read(shown, s.path) : s.value,
                to: s.value, now: now, glide: glide, ease: batchEase)
        }
        keyframeWake?()
    }

    // MARK: Keyframes (`timeline`)

    /// Drives a scene's `timeline`: re-resolves the authored JSON on the
    /// scene's own clock and recompiles when the resolved scene changes.
    /// Compiling is deterministic per seed, so every entity keeps its place
    /// across recompiles — the web's rebuild-on-structural-change, in effect.
    /// Ticks at the tier's rate only while a glide is in flight, and sleeps
    /// through holds until the next key.
    private var keyframeTask: Task<Void, Never>?
    /// What the driver is playing: the authored JSON and its seed.
    private var keyframeSource: (json: JSONValue, seed: Int)?
    /// Live steers held on the driven timeline, by index-form path, and which
    /// server steer each path last armed (`t|value`).
    private var keyframeOverrides: [String: SpecTimeline.Override] = [:]
    private var seenSteers: [String: String] = [:]
    /// The frame the driver last put on screen, and a nudge for its sleep.
    private var keyframeShown: JSONValue?
    private var keyframeWake: (() -> Void)?
    /// When the driven timeline's clock read 0.
    private var keyframeEpoch: Date?

    private func isDrivingKeyframes(_ json: JSONValue, seed: Int) -> Bool {
        guard keyframeTask != nil, let src = keyframeSource else { return false }
        return src.seed == seed && src.json == json
    }

    /// How often a glide is re-resolved: every frame on Canvas; the sprite
    /// tier rebinds its nodes in place (cached, tinted textures), at 12 Hz.
    var keyframeInterval: TimeInterval { effectiveTier == .t3 ? 1.0 / 60 : 1.0 / 12 }

    private func stopKeyframes() {
        keyframeTask?.cancel()
        keyframeTask = nil
        keyframeSource = nil
        keyframeWake?()
        keyframeWake = nil
        keyframeShown = nil
        keyframeOverrides = [:]
    }

    /// `epoch`: when the scene's clock read 0 (a segment entered earlier
    /// resumes its timeline where it is, not from the top).
    private func startKeyframes(_ source: JSONValue, seed: Int, epoch: Date = Date()) {
        if isDrivingKeyframes(source, seed: seed) { return }
        stopKeyframes()
        guard SpecTimeline.hasTimeline(source) else { return }
        keyframeSource = (source, seed)
        keyframeEpoch = epoch
        keyframeOverrides = [:]
        seenSteers = [:]
        keyframeTask = Task { [weak self] in
            var last: JSONValue?
            var slow = 0
            while !Task.isCancelled {
                guard let self else { return }
                let interval = self.keyframeInterval
                let t = Date().timeIntervalSince(epoch) * 1000
                var resolved = SpecTimeline.resolve(source, at: t)
                if !self.keyframeOverrides.isEmpty {
                    (resolved, self.keyframeOverrides) = SpecTimeline.applyOverrides(resolved, self.keyframeOverrides, at: t)
                }
                self.keyframeShown = resolved
                if resolved != last {
                    let began = Date()
                    guard self.applyKeyframe(resolved, seed: seed) else { return }
                    last = resolved
                    // A box that can't recompile inside one tick holds the
                    // scene where it is rather than falling behind its clock.
                    slow = Date().timeIntervalSince(began) > interval ? slow + 1 : 0
                    if slow >= 3 { return }
                }
                // A held steer animates on its own; otherwise sleep to the next key
                // (a new steer wakes the loop early).
                let next = self.keyframeOverrides.isEmpty ? SpecTimeline.nextChange(source, after: t) : t
                let wait = next.map { $0 <= t ? interval : Swift.max(interval, ($0 - t) / 1000) } ?? 3600
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    let once = OnceFlag()
                    let fire = { if once.claim() { done.resume() } }
                    self.keyframeWake = fire
                    Task { try? await Task.sleep(for: .seconds(wait)); fire() }
                }
                self.keyframeWake = nil
            }
        }
    }

    /// The ground, smear, seed and finish of the scene now on screen.
    private func setGround(_ spec: SpecSubset?, seed: Int) {
        specBackground = spec?.background
        specGhosting = spec?.ghosting ?? 0
        specSeed = seed
        finishSeed = seed
        specFinish = spec?.finish
    }

    /// One resolved keyframe state on screen. False when it no longer decodes.
    private func applyKeyframe(_ json: JSONValue, seed: Int) -> Bool {
        guard let data = try? JSONEncoder().encode(json),
              let spec = try? JSONDecoder().decode(SpecSubset.self, from: data) else { return false }
        compiledScene = spec.compile(seed: seed, budget: sceneBudget)
        if !hasBed {
            specBackground = spec.background
            specGhosting = spec.ghosting ?? 0
        }
        if activeSequence?.finish == nil { specFinish = spec.finish }
        return true
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

/// A latch that lets exactly one of several racers resume a continuation.
private final class OnceFlag: @unchecked Sendable {
    private var used = false
    private let lock = NSLock()
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if used { return false }
        used = true
        return true
    }
}

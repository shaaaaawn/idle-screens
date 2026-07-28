import Foundation
import Observation

/// Live state for one channel being watched natively on iOS: opens the
/// channel socket, decodes published scenes into compiled entities, and
/// tracks sleep/overlay/viewers. Mirrors the tvOS viewer path — the phone
/// renders the scene itself instead of embedding the website.
@MainActor @Observable
final class ChannelSession {
    private(set) var compiledScene: [CompiledLayer] = []
    private(set) var background: SpecSubset.Background?
    private(set) var sleeping = false
    private(set) var viewers: Int?
    private(set) var overlayText: String?
    private(set) var sceneLabel: String?
    /// True when the channel publishes a classic saver (`{"id":"warp"}`),
    /// which has no native representation — the viewer falls back to the
    /// hosted page for those.
    private(set) var isClassicSpec = false
    private(set) var hasScene = false

    /// Every state the viewer can be in, named. Without this the UI had only
    /// "scene or spinner", so a socket that never delivered showed a spinner
    /// forever and a failed connect looked identical to a slow one.
    enum Phase: Equatable {
        case connecting     // no frame yet — hold the channel's own backdrop
        case live           // rendering
        case unreachable    // gave up; offer a retry
    }

    private(set) var phase: Phase = .connecting
    /// Backdrop colour taken from the spec before anything renders, so the
    /// entry transition is channel-coloured rather than a black flash.
    private(set) var backdrop: String?

    private var channelId: String?
    private let ws: ChannelWSClient
    private let baseURL: URL
    private var task: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?

    init(ws: ChannelWSClient = ChannelWSClient(), baseURL: URL = URL(string: Config.baseURL)!) {
        self.ws = ws
        self.baseURL = baseURL
    }

    /// Paint the gallery's inline spec immediately so the first frame is real
    /// content, then let the socket's snapshot replace it.
    func start(channelId: String, seedSpec: SpecSubset?) {
        self.channelId = channelId
        backdrop = seedSpec?.background?.primaryColor
        phase = hasScene ? .live : .connecting
        armConnectTimeout()
        if let seedSpec {
            apply(spec: seedSpec, fallbackSeed: seedSpec.seed)
        }
        task?.cancel()
        task = Task { [weak self] in
            guard let self else { return }
            do {
                for try await event in await ws.events(baseURL: baseURL, channelId: channelId) {
                    guard !Task.isCancelled else { break }
                    self.handle(event)
                }
            } catch {
                // Stream ended — the view restarts it on next appearance.
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        timeoutTask?.cancel()
        timeoutTask = nil
    }

    /// Retry after a failure — the user asked for it, so start clean.
    func retry() {
        guard let channelId else { return }
        phase = .connecting
        start(channelId: channelId, seedSpec: nil)
    }

    /// A socket that connects but never delivers is indistinguishable from a
    /// slow one until you bound it. 10s is generous for a snapshot.
    private func armConnectTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard let self, !Task.isCancelled, !self.hasScene else { return }
            self.phase = .unreachable
        }
    }

    func handle(_ event: ChannelWSEvent) {
        switch event {
        case .snapshot(let snapshot):
            sleeping = snapshot.sleeping ?? sleeping
            viewers = snapshot.viewers
            if let spec = snapshot.resolvedSpec ?? snapshot.scene ?? snapshot.spec {
                decode(spec, fallbackSeed: snapshot.epoch)
            }
        case .scene(let spec, let seed):
            if let spec { decode(spec, fallbackSeed: seed) }
        case .sleep:
            sleeping = true
        case .wake:
            sleeping = false
        case .overlay(let text, let ttl):
            overlayText = text
            let ttlMs = ttl ?? 4000
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(ttlMs))
                self?.overlayText = nil
            }
        case .delta, .switchChannel:
            break
        }
    }

    private func decode(_ json: JSONValue, fallbackSeed: Int?) {
        guard let data = try? JSONEncoder().encode(json),
              let spec = try? JSONDecoder().decode(SpecSubset.self, from: data),
              !spec.layers.isEmpty else {
            isClassicSpec = true
            compiledScene = []
            background = nil
            return
        }
        isClassicSpec = false
        apply(spec: spec, fallbackSeed: fallbackSeed)
    }

    private func apply(spec: SpecSubset, fallbackSeed: Int?) {
        compiledScene = spec.compile(seed: spec.seed ?? fallbackSeed ?? 0,
                                     budget: SpecSubset.Budget.fullscreen)
        background = spec.background
        sceneLabel = spec.label ?? spec.id
        hasScene = !compiledScene.isEmpty
        if hasScene {
            phase = .live
            timeoutTask?.cancel()
        }
        // Breadcrumb for MetricKit: if the app dies rendering this, the
        // report names the channel and how heavy the scene was.
        CrashReporter.shared.noteRendering(
            channelId: channelId,
            entityCount: compiledScene.reduce(0) { $0 + $1.entities.count })
    }
}

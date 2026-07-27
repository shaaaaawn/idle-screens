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

    private let ws: ChannelWSClient
    private let baseURL: URL
    private var task: Task<Void, Never>?

    init(ws: ChannelWSClient = ChannelWSClient(), baseURL: URL = URL(string: Config.baseURL)!) {
        self.ws = ws
        self.baseURL = baseURL
    }

    /// Paint the gallery's inline spec immediately so the first frame is real
    /// content, then let the socket's snapshot replace it.
    func start(channelId: String, seedSpec: SpecSubset?) {
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
        compiledScene = spec.compile(seed: spec.seed ?? fallbackSeed ?? 0)
        background = spec.background
        sceneLabel = spec.label ?? spec.id
        hasScene = !compiledScene.isEmpty
    }
}

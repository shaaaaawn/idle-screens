import Foundation
import Observation

/// Live state for one channel being watched on iOS — what the NATIVE chrome
/// knows about the channel: its label, viewers, sleep state, presets.
///
/// Two ways to be fed, because there are two ways to draw:
///
/// - `.socket` — the session opens the channel socket itself and compiles each
///   scene into entities for the native renderer (tvOS has no WebKit, and the
///   gallery's tiles are native either way).
/// - `.host` — a `WebSceneView` is drawing the scene with the real web engine,
///   and forwards the frames of the page's OWN socket here. The session opens
///   nothing. One socket per viewer matters: the server counts every socket as
///   a viewer, so a second one would show the phone as two people watching.
@MainActor @Observable
final class ChannelSession {
    enum Source { case socket, host }
    private(set) var source: Source = .socket

    private(set) var compiledScene: [CompiledLayer] = []
    private(set) var background: SpecSubset.Background?
    private(set) var sleeping = false

    /// Flip locally the instant a wake is accepted. The socket will push the
    /// authoritative state a moment later; without this the button looks
    /// ignored for a full round trip.
    func optimisticallyAwake() { sleeping = false }
    private(set) var viewers: Int?
    /// Saved presets on this channel. The server has sent these on every state
    /// push since presets existed; nothing rendered them until now.
    private(set) var presets: [String] = []
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
    /// The colour at the bottom of the scene's background. A gradient can be
    /// pale at the top and dark at the foot (or the reverse), and the caption
    /// lives at the foot — so it is judged separately from the top bar.
    private(set) var backdropBottom: String?

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
    func start(channelId: String, seedSpec: SpecSubset?, source: Source = .socket) {
        self.source = source
        self.channelId = channelId
        backdrop = seedSpec?.background?.primaryColor
        phase = hasScene ? .live : .connecting
        armConnectTimeout()
        if let seedSpec {
            apply(spec: seedSpec, fallbackSeed: seedSpec.seed)
        }
        task?.cancel()
        // Host mode: the web view's socket is the only socket. Frames arrive
        // through `ingest(_:)`.
        guard source == .socket else { return }
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
        start(channelId: channelId, seedSpec: nil, source: source)
    }

    /// One raw frame from the hosted page's socket. Same parser as our own
    /// socket, so the two sources cannot drift in what they understand.
    func ingest(_ raw: String) {
        guard source == .host, let event = ChannelWSClient.parse(raw) else { return }
        handle(event)
    }

    /// The web view failed before any frame arrived (offline, DNS, 5xx).
    func hostFailed() {
        guard source == .host, !hasScene else { return }
        timeoutTask?.cancel()
        phase = .unreachable
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
            if let names = snapshot.presets { presets = names }
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
            // The hosted page draws overlays itself, with their style and
            // region. A native copy on top would show each one twice.
            guard source == .socket else { break }
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
        if source == .host {
            noteHostedScene(json)
            return
        }
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

    /// Host mode: the web engine draws, so compiling entities here would burn
    /// CPU and memory on a picture nobody sees. The chrome needs two facts —
    /// what the scene is called and what colour to hold behind it.
    private func noteHostedScene(_ json: JSONValue) {
        let doc = json.normalizedSpec()
        guard case .object(let fields) = doc else { return }
        // A sequence envelope names itself at the top; a classic saver is
        // just `{"id": "warp"}`. Either way label-then-id is the right read.
        sceneLabel = fields["label"]?.stringValue ?? fields["id"]?.stringValue
        if case .object(let bg)? = fields["background"] {
            if case .array(let stops)? = bg["stops"], !stops.isEmpty {
                if case .object(let first)? = stops.first { backdrop = first["color"]?.stringValue ?? backdrop }
                if case .object(let last)? = stops.last { backdropBottom = last["color"]?.stringValue }
            } else if let color = bg["color"]?.stringValue {
                backdrop = color
                backdropBottom = color
            }
        }
        isClassicSpec = false
        compiledScene = []
        hasScene = true
        phase = .live
        timeoutTask?.cancel()
        CrashReporter.shared.noteRendering(channelId: channelId, entityCount: 0)
    }
}

import Observation
import WebKit

/// Loaded channel pages, kept warm so moving between them is instant.
///
/// A page costs ~1.4 s to arrive (load ~0.6 s, boot and connect ~0.55 s, then
/// mount and draw) — measured 2026-10-16. The history pager only keeps pages
/// next to the current one alive, so stepping back to live, or back and forth,
/// paid that every time. The pool keeps up to `maxIdle` pages that have left
/// the screen, and can load the page a swipe is about to land on in advance.
///
/// Bounded on purpose: each page is a web process and an open socket (the
/// server counts sockets as viewers), so the pool holds only the channel you
/// are on and is drained when you flip channel, change tab or background the
/// app. A 3D tank is never pooled. Flipping channel spares one page for a few
/// seconds — the live one you left — for the next channel to `adopt`.
///
/// It also keeps a small picture of each page as last seen (`snapshot`). A
/// page swiped back into view slides in showing that, not its bare
/// background colour: a sequence or timeline has no native still, so without
/// it the page arrived as a dark slab and the scene popped in over it.
@MainActor
@Observable
final class WebScenePool {
    static let shared: WebScenePool = {
        let pool = WebScenePool()
        pool.loadLaunchStills()
        return pool
    }()

    struct Key: Hashable {
        let channelId: String
        let sceneId: Int?
        /// A page seeded with a key lives in its own store; never hand it to
        /// a view that didn't ask for one.
        let keyed: Bool
    }

    private struct Entry {
        /// Identity of this parking: taking a page out and parking it again is a new entry.
        let id = UUID()
        let key: Key
        let webView: WKWebView
        let host: WebSceneView.Coordinator
    }

    /// Live, the page you just left, and the one warmed ahead of the swipe.
    @ObservationIgnored let maxIdle = 3
    @ObservationIgnored private var idle: [Entry] = []          // least recently parked first

    /// Half-width pictures (~3 MB each at 3x), newest last.
    @ObservationIgnored let maxSnapshots = 8
    private var snapshots: [String: UIImage] = [:]
    @ObservationIgnored private var snapshotOrder: [String] = []

    private static func snapshotKey(_ channelId: String, _ sceneId: Int?) -> String {
        "\(channelId)#\(sceneId.map(String.init) ?? "live")"
    }

    /// The page as it last looked on screen, if it has been shown.
    func snapshot(channelId: String, sceneId: Int?) -> UIImage? {
        snapshots[Self.snapshotKey(channelId, sceneId)]
    }

    func storeSnapshot(_ image: UIImage, channelId: String, sceneId: Int?) {
        let key = Self.snapshotKey(channelId, sceneId)
        snapshotOrder.removeAll { $0 == key }
        snapshotOrder.append(key)
        snapshots[key] = image
        while snapshotOrder.count > maxSnapshots {
            snapshots[snapshotOrder.removeFirst()] = nil
        }
    }


    /// Take a warm page for `key`, if there is one.
    func take(_ key: Key) -> (WKWebView, WebSceneView.Coordinator)? {
        guard let index = idle.lastIndex(where: { $0.key == key }) else { return nil }
        let entry = idle.remove(at: index)
        return (entry.webView, entry.host)
    }

    /// A warm live page of ANOTHER public channel, to be switched in place to
    /// `channelId` (`WebSceneView.Coordinator.retarget`) — what a channel flip
    /// does instead of loading a page: a new page waits on a web process and
    /// a commit (0.4–0.9 s on a loaded simulator, 15 s once, 2026-10-25); a
    /// switch in place has its first frame in ~0.1 s.
    /// Public and live only: a keyed page lives in its own store with its own
    /// token, and a pinned scene is a document of its own.
    func adopt(forChannel channelId: String) -> (WKWebView, WebSceneView.Coordinator)? {
        guard let index = idle.lastIndex(where: {
            $0.key.sceneId == nil && !$0.key.keyed && $0.key.channelId != channelId
            && !$0.webView.isLoading   // a page still booting has no document to switch
        }) else { return nil }
        let entry = idle.remove(at: index)
        return (entry.webView, entry.host)
    }

    /// Live public pages on screen right now — normally one, the channel you
    /// are watching. Weak: SwiftUI owns the containers.
    @ObservationIgnored private let onScreen = NSHashTable<SceneHostView>.weakObjects()

    func showing(_ container: SceneHostView) { onScreen.add(container) }
    func notShowing(_ container: SceneHostView) { onScreen.remove(container) }

    /// The live page of ANOTHER public channel still on screen, taken out of
    /// its view for `channelId` to switch in place. Only the page being left
    /// can be on screen when a new channel's page is built: the app has one
    /// window (no multi-scene manifest), the feed gives exactly one page the
    /// engine, and SwiftUI builds the next before it dismantles the last. The view it leaves keeps showing its still, and
    /// stops keeping pictures of a page that is no longer its channel.
    func handOver(forChannel channelId: String) -> (WKWebView, WebSceneView.Coordinator)? {
        guard let donor = onScreen.allObjects.last(where: {
            $0.webView?.isLoading == false && $0.coordinator?.host?.channelId != channelId
        }), let coordinator = donor.coordinator, let host = coordinator.host,
              let webView = donor.release() else { return nil }
        onScreen.remove(donor)
        coordinator.snapshotTask?.cancel()
        host.sink = nil
        return (webView, host)
    }

    /// Keep a page that just left the screen.
    func park(_ key: Key, webView: WKWebView, host: WebSceneView.Coordinator) {
        if let stale = idle.firstIndex(where: { $0.key == key }) {
            Self.teardown(idle.remove(at: stale).webView)
        }
        idle.append(Entry(key: key, webView: webView, host: host))
        trim()
    }

    /// Start loading a page before it is needed (the one a swipe will land on).
    func prewarm(channelId: String, sceneId: Int?, token: String?, baseURL: URL) {
        let key = Key(channelId: channelId, sceneId: sceneId, keyed: token != nil)
        guard !idle.contains(where: { $0.key == key }) else { return }
        SwipeTiming.mark("prewarm \(sceneId.map(String.init) ?? "live")")
        let host = WebSceneView.Coordinator(channelId: channelId, baseURL: baseURL, onFrame: { _ in }, onFailure: {})
        let webView = WebSceneView.build(channelId: channelId, token: token, baseURL: baseURL,
                                         sceneId: sceneId, delegate: host)
        // Off-screen views barely run; a real size lets the page lay out and
        // mount at the shape it will be shown at.
        webView.frame = UIScreen.main.bounds
        park(key, webView: webView, host: host)
    }

    /// How long the live page of a channel just left stays connected, waiting
    /// for the next channel to `adopt` it. Short: until then it is still a
    /// viewer of the channel you left.
    @ObservationIgnored var adoptionGrace: Duration = .seconds(3)

    /// Drop warm pages — one channel's, or all. `keepSnapshots` keeps their
    /// pictures (backgrounding: the channel you return to is the same one).
    ///
    /// Leaving one channel spares its public live page for `adoptionGrace`:
    /// that is the page the channel flipped to switches in place.
    func drain(channelId: String? = nil, keepSnapshots: Bool = false) {
        let (gone, kept) = idle.reduce(into: ([Entry](), [Entry]())) { acc, entry in
            if channelId == nil || entry.key.channelId == channelId { acc.0.append(entry) } else { acc.1.append(entry) }
        }
        idle = kept
        for entry in gone {
            if channelId != nil, entry.key.sceneId == nil, !entry.key.keyed {
                idle.append(entry)
                expire(entry, after: adoptionGrace)
            } else {
                Self.teardown(entry.webView)
            }
        }
        if keepSnapshots { return }
        // Pictures only help within one visit; on the next the scene has moved on.
        let stale = snapshotOrder.filter { channelId == nil || $0.hasPrefix("\(channelId!)#") }
        stale.forEach { snapshots[$0] = nil }
        snapshotOrder.removeAll { stale.contains($0) }
    }

    /// Tear a spared page down after `delay` unless something took it
    /// meanwhile. Matched on the entry itself: a page taken or adopted and parked again
    /// (under any key) is a different entry, with a full life ahead.
    private func expire(_ spared: Entry, after delay: Duration) {
        let id = spared.id
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self,
                  let index = self.idle.firstIndex(where: { $0.id == id }) else { return }
            Self.teardown(self.idle.remove(at: index).webView)
        }
    }

    var idleCount: Int { idle.count }

    func has(channelId: String, sceneId: Int?) -> Bool {
        idle.contains { $0.key.channelId == channelId && $0.key.sceneId == sceneId }
    }

    /// Over the limit, the oldest HISTORY page goes first: the live page is
    /// the one you return to most, and reloading it costs the most to watch.
    private func trim() {
        while idle.count > maxIdle {
            let victim = idle.firstIndex { $0.key.sceneId != nil } ?? 0
            Self.teardown(idle.remove(at: victim).webView)
        }
    }

    // MARK: Launch stills

    /// Live pictures kept across launches, so the app opens onto the channel
    /// as it last looked rather than onto its background colour. Each is
    /// filed under the channel's `lastEventAt`: any publish or steer since
    /// makes it a different scene, and that picture is never shown.
    @ObservationIgnored private var launchStills: [String: (signature: Int, image: UIImage)] = [:]

    private static var stillsDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("launch-stills", isDirectory: true)
    }

    /// The picture saved last session for this channel, if its scene is unchanged.
    func launchStill(channelId: String, signature: Int?) -> UIImage? {
        guard let signature, let still = launchStills[channelId], still.signature == signature else { return nil }
        return still.image
    }

    /// Write the live pictures of this visit to disk (on backgrounding).
    func persistLaunchStills(signature: (String) -> Int?) {
        var out: [(String, Int, UIImage)] = []
        for key in snapshotOrder.reversed() where key.hasSuffix("#live") {
            let channelId = String(key.dropLast("#live".count))
            guard Self.isSafeFileName(channelId), let sig = signature(channelId),
                  let image = snapshots[key] else { continue }
            out.append((channelId, sig, image))
            launchStills[channelId] = (sig, image)
        }
        guard !out.isEmpty else { return }
        let dir = Self.stillsDirectory
        Task.detached(priority: .utility) {
            let fm = FileManager.default
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            for (channelId, sig, image) in out {
                // One file per channel: drop its older pictures first.
                let old = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
                for name in old where name.hasPrefix("\(channelId)~") { try? fm.removeItem(at: dir.appendingPathComponent(name)) }
                if let data = image.jpegData(compressionQuality: 0.7) {
                    try? data.write(to: dir.appendingPathComponent("\(channelId)~\(sig).jpg"), options: .atomic)
                }
            }
            // Bounded: the newest few channels only.
            let files = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
                .sorted { a, b in
                    let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    return da > db
                }
            for stale in files.dropFirst(8) { try? fm.removeItem(at: stale) }
        }
    }

    private func loadLaunchStills() {
        let dir = Self.stillsDirectory
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for name in names where name.hasSuffix(".jpg") {
            let stem = name.dropLast(4)
            guard let tilde = stem.lastIndex(of: "~"),
                  let sig = Int(stem[stem.index(after: tilde)...]),
                  let image = UIImage(contentsOfFile: dir.appendingPathComponent(name).path) else { continue }
            launchStills[String(stem[..<tilde])] = (sig, image)
        }
    }

    /// Channel ids are kebab-case; anything else never becomes a file name.
    static func isSafeFileName(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" || $0 == "_"
        }
    }

    /// Stop a page for good: no more network, no socket, no handler.
    static func teardown(_ webView: WKWebView) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: WebSceneView.handlerName)
        // Closes the page's socket now rather than whenever the view is freed.
        webView.loadHTMLString("", baseURL: nil)
    }
}

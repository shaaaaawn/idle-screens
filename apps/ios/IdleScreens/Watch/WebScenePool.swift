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
/// app. A 3D tank is never pooled.
///
/// It also keeps a small picture of each page as last seen (`snapshot`). A
/// page swiped back into view slides in showing that, not its bare
/// background colour: a sequence or timeline has no native still, so without
/// it the page arrived as a dark slab and the scene popped in over it.
@MainActor
@Observable
final class WebScenePool {
    static let shared = WebScenePool()

    struct Key: Hashable {
        let channelId: String
        let sceneId: Int?
        /// A page seeded with a key lives in its own store; never hand it to
        /// a view that didn't ask for one.
        let keyed: Bool
    }

    private struct Entry {
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
        let host = WebSceneView.Coordinator(baseURL: baseURL, onFrame: { _ in }, onFailure: {})
        let webView = WebSceneView.build(channelId: channelId, token: token, baseURL: baseURL,
                                         sceneId: sceneId, delegate: host)
        // Off-screen views barely run; a real size lets the page lay out and
        // mount at the shape it will be shown at.
        webView.frame = UIScreen.main.bounds
        park(key, webView: webView, host: host)
    }

    /// Drop warm pages — one channel's, or all.
    func drain(channelId: String? = nil) {
        let (gone, kept) = idle.reduce(into: ([Entry](), [Entry]())) { acc, entry in
            if channelId == nil || entry.key.channelId == channelId { acc.0.append(entry) } else { acc.1.append(entry) }
        }
        idle = kept
        gone.forEach { Self.teardown($0.webView) }
        // Pictures only help within one visit; on the next the scene has moved on.
        let stale = snapshotOrder.filter { channelId == nil || $0.hasPrefix("\(channelId!)#") }
        stale.forEach { snapshots[$0] = nil }
        snapshotOrder.removeAll { stale.contains($0) }
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

    /// Stop a page for good: no more network, no socket, no handler.
    static func teardown(_ webView: WKWebView) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: WebSceneView.handlerName)
        // Closes the page's socket now rather than whenever the view is freed.
        webView.loadHTMLString("", baseURL: nil)
    }
}

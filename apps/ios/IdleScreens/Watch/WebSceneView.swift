import SwiftUI
import WebKit

/// The scene, drawn by the real web engine — and nothing else.
///
/// The division of labour is strict, because blurring it is what makes a hybrid
/// app feel like a website in a costume:
///
/// - **The web layer draws pixels.** It loads the channel's own page with
///   `?chrome=off`, the mode the site built for native hosts, so every scene
///   renders exactly as it does on idlescreens.com: classic savers, sequences,
///   metaquarium, whatever the schema grows next — with no native port to
///   fall behind.
/// - **Everything you can touch is native.** The web view has user interaction
///   disabled outright, so there is no web button to find, no text to select,
///   no page to scroll. Taps, swipes and drags all land on SwiftUI.
///
/// Native chrome still needs to know the channel's state. Rather than open a
/// second socket (the server counts every socket as a viewer — the phone would
/// show up as two people), a user script taps the page's OWN socket and
/// forwards each frame here. One connection, and the chrome is guaranteed to
/// describe the same stream the pixels came from.
struct WebSceneView: UIViewRepresentable {
    let channelId: String
    let baseURL: URL
    /// Held only for channels this device controls. Seeded into the page's
    /// storage, never its URL — the server's threat model rules URLs out
    /// (they land in logs), and so do we.
    var token: String?
    /// A stored scene to open on instead of what the channel is playing
    /// (`?scene=<id>`): the site mounts it detached, as its own timeline scrub
    /// does — a local read that reports nothing back to the channel.
    var sceneId: Int? = nil
    /// Bump to force a reload (the native "Try again").
    var reloadCount: Int = 0
    var onFrame: (String) -> Void
    /// 3D models still downloading in the page (0 = the scene has its cast).
    var onAssets: ((Int) -> Void)? = nil
    /// Fish a 3D tank has spawned so far (the tank's own count).
    var onFish: ((Int) -> Void)? = nil
    /// The pinned scene (see `sceneId`) has mounted and drawn in the page.
    var onPinned: (() -> Void)? = nil
    /// Reusing an already-loaded page from `WebScenePool`: it has painted
    /// before this view ever appeared, so nothing needs to wait for it.
    var onReused: (() -> Void)? = nil
    /// Keep this page warm in `WebScenePool` when it leaves the screen. Off
    /// for a 3D tank — one of those running at a time is the rule.
    var poolable: Bool = true
    var onFailure: () -> Void

    static func sceneURL(baseURL: URL, channelId: String, sceneId: Int? = nil) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("channel").appendingPathComponent(channelId),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "chrome", value: "off")]
        if let sceneId, sceneId > 0 {
            components.queryItems?.append(URLQueryItem(name: "scene", value: String(sceneId)))
        }
        return components.url!
    }

    func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator(baseURL: baseURL, onFrame: onFrame, onFailure: onFailure)
        coordinator.onAssets = onAssets
        coordinator.onPinned = onPinned
        coordinator.onFish = onFish
        return coordinator
    }

    var poolKey: WebScenePool.Key {
        WebScenePool.Key(channelId: channelId, sceneId: sceneId, keyed: token != nil)
    }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        coordinator.loaded = (channelId, reloadCount)
        coordinator.poolKey = poolable ? poolKey : nil
        // A page we already loaded — this one a moment ago, or warmed ahead of
        // the swipe — comes back as it was: booted, connected, drawn.
        if poolable, let (webView, host) = WebScenePool.shared.take(poolKey) {
            SwipeTiming.mark("web view reused from pool")
            host.sink = coordinator
            coordinator.host = host
            // Replay what it already said once it is back on screen and drawn:
            // a re-attached web view shows black until its layer composites
            // again (caught at 30 fps, 2026-10-16), and revealing it sooner
            // flashed a dark frame.
            // So: ask the page. Two of ITS animation frames after it is back in
            // a window, it has composited; a guessed 0.12 s was not enough.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(16))   // let it attach
                _ = try? await webView.callAsyncJavaScript(
                    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
                    contentWorld: .page)
                if let frame = host.lastFrame { coordinator.onFrame(frame) }
                if let assets = host.lastAssets { coordinator.onAssets?(assets) }
                if let fish = host.lastFish { coordinator.onFish?(fish) }
                if host.painted { coordinator.onPinned?() }
                if host.lastFrame != nil || host.painted { coordinator.onReused?() }
            }
            coordinator.startSnapshots(of: webView, channelId: channelId, sceneId: sceneId)
            return webView
        }
        SwipeTiming.mark("web view created")
        coordinator.host = coordinator
        let webView = Self.build(channelId: channelId, token: token, baseURL: baseURL,
                                 sceneId: sceneId, delegate: coordinator)
        if poolable { coordinator.startSnapshots(of: webView, channelId: channelId, sceneId: sceneId) }
        return webView
    }

    /// One configured, loading web view for a channel page. Shared by the
    /// view and by `WebScenePool.prewarm`, so a warmed page is identical.
    static func build(channelId: String, token: String?, baseURL: URL, sceneId: Int?,
                      delegate: Coordinator) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.applicationNameForUserAgent = "IdleScreens-iOS"
        // A page holding a steering token gets a store that dies with the
        // view. Public viewing keeps the default store, so the site's hashed
        // bundles stay cached and a channel opens fast.
        if token != nil { config.websiteDataStore = .nonPersistent() }

        let controller = config.userContentController
        controller.add(WeakScriptHandler(delegate), name: Self.handlerName)
        controller.addUserScript(WKUserScript(
            source: Self.bootstrapScript(channelId: channelId, token: token, baseURL: baseURL),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        // Transparent until the page paints: the native backdrop behind it is
        // already the channel's colour, so entering never flashes white.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        // The whole point. Nothing in the web layer is reachable by a finger.
        webView.isUserInteractionEnabled = false
        webView.navigationDelegate = delegate
        webView.load(URLRequest(url: Self.sceneURL(baseURL: baseURL, channelId: channelId, sceneId: sceneId)))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onFrame = onFrame
        context.coordinator.onAssets = onAssets
        context.coordinator.onPinned = onPinned
        context.coordinator.onFish = onFish
        context.coordinator.onReused = onReused
        context.coordinator.onFailure = onFailure
        guard context.coordinator.loaded != (channelId, reloadCount) else { return }
        context.coordinator.loaded = (channelId, reloadCount)
        webView.load(URLRequest(url: Self.sceneURL(baseURL: baseURL, channelId: channelId, sceneId: sceneId)))
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.snapshotTask?.cancel()
        let host = coordinator.host ?? coordinator
        host.sink = nil
        if let key = coordinator.poolKey {
            WebScenePool.shared.park(key, webView: webView, host: host)
        } else {
            WebScenePool.teardown(webView)
        }
    }

    // MARK: Page bootstrap

    static let handlerName = "idleHost"

    /// Runs before any page script. Three jobs: seed the token, tap the socket,
    /// and switch off the two behaviours that make a web view feel like one.
    ///
    /// Values are embedded as JSON literals — never string-concatenated — and
    /// the token is re-validated against the server's own pattern first, so a
    /// malformed Keychain value cannot become script.
    static func bootstrapScript(channelId: String, token: String?, baseURL: URL) -> String {
        func literal(_ value: String) -> String {
            let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
            let array = String(decoding: data, as: UTF8.self)
            return String(array.dropFirst().dropLast())
        }
        // The channel socket's expected origin, derived from the native-trusted
        // `baseURL` rather than the page's own `location` — a hijacked or
        // injected page script must not be able to widen what counts as "the
        // channel socket" by controlling where it thinks it's loaded from.
        let wsProtocol = baseURL.scheme == "https" ? "wss:" : "ws:"
        let wsHost = baseURL.host ?? ""
        let wsPort = baseURL.port.map(String.init) ?? ""
        var seed = ""
        if let token, isWellFormed(token) {
            seed = "try { localStorage.setItem(\(literal("isk:" + channelId)), \(literal(token))); } catch (_) {}"
        }
        return """
        (() => {
          \(seed)
          const post = (kind, body) => {
            try { window.webkit.messageHandlers.\(handlerName).postMessage({ kind, body }); } catch (_) {}
          };
          // Only the channel's own stream is instrumented. A page that opens
          // some OTHER socket (telemetry, an embed, or one on a spoofed
          // origin) must never have its frames posted here — ChannelSession
          // treats matching JSON as authoritative state, so an unrelated
          // socket could spoof it. Origin (protocol+host+port) and path must
          // match exactly; a path suffix alone would let
          // wss://attacker.example/anything/c/<id>/ws slip through.
          const channelSocketProtocol = \(literal(wsProtocol));
          const channelSocketHost = \(literal(wsHost));
          const channelSocketPort = \(literal(wsPort));
          const channelSocketPath = \(literal("/c/" + channelId + "/ws"));
          const isChannelSocket = (url) => {
            try {
              const u = new URL(url, location.href);
              return u.protocol === channelSocketProtocol
                && u.hostname === channelSocketHost
                && u.port === channelSocketPort
                && u.pathname === channelSocketPath;
            } catch (_) { return false; }
          };
          const Native = window.WebSocket;
          if (Native && !Native.__idleTapped) {
            const Tapped = function (url, protocols) {
              const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
              if (isChannelSocket(url)) {
                ws.addEventListener('message', (e) => { if (typeof e.data === 'string') post('frame', e.data); });
              }
              return ws;
            };
            Tapped.prototype = Native.prototype;
            Tapped.CONNECTING = 0; Tapped.OPEN = 1; Tapped.CLOSING = 2; Tapped.CLOSED = 3;
            Tapped.__idleTapped = true;
            window.WebSocket = Tapped;
          }
          // How many 3D models the page is still downloading. A three.js tank
          // mounts empty and fills over 10-20s; this is the only honest signal
          // of "still loading" a canvas offers. Counts only — never URLs or
          // bodies — so it carries nothing a hostile page could abuse.
          const nativeFetch = window.fetch;
          if (nativeFetch && !nativeFetch.__idleTapped) {
            let pending = 0;
            const isModel = (u) => /\\.(glb|gltf|bin|drc|wasm)(\\?|$)/i.test(u) || /\\/ipfs\\//i.test(u);
            const tapped = function (input, init) {
              let url = '';
              try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
              const counted = isModel(url);
              // The pinned past scene (?scene=) arriving is the moment it can
              // mount — a real "ready" signal instead of a guessed delay.
              const pinned = /\\/c\\/[^/]+\\/scene\\/\\d+/.test(url);
              if (counted) post('assets', String(++pending));
              const done = () => {
                if (counted) post('assets', String(--pending));
                if (pinned) window.__idlePinnedArrived = true;
              };
              const p = nativeFetch.call(this, input, init);
              p.then(done, done);
              return p;
            };
            tapped.__idleTapped = true;
            window.fetch = tapped;
          }
          // "Painted", for a pinned past scene: every mount drops the old
          // canvas and appends a new one to #screen. The first canvas added
          // AFTER the pinned scene's data arrived is that scene; two animation
          // frames later it has drawn. Earlier than that the page is still
          // its bare background — revealing on the data alone showed a black
          // frame (2026-10-16).
          if (window.MutationObserver && !window.__idlePaintWatch) {
            window.__idlePaintWatch = true;
            const watch = new MutationObserver((records) => {
              if (!window.__idlePinnedArrived) return;
              for (const r of records) {
                for (const n of r.addedNodes) {
                  if (n.nodeName === 'CANVAS' && n.closest && n.closest('#screen')) {
                    watch.disconnect();
                    requestAnimationFrame(() => requestAnimationFrame(() => post('pinned', '1')));
                    return;
                  }
                }
              }
            });
            watch.observe(document.documentElement, { childList: true, subtree: true });
          }
          // How many fish a 3D tank has spawned: the tank writes it on its
          // host as data-mq-fish. Its models are bundled now, so the fetch tap
          // above rarely sees one — this is the tank's own word on its cast.
          // A clamped integer only.
          if (window.MutationObserver && !window.__idleFishWatch) {
            window.__idleFishWatch = true;
            let lastFish = null;
            new MutationObserver((records) => {
              for (const r of records) {
                const n = parseInt(r.target.getAttribute('data-mq-fish') || '0', 10);
                const v = String(Math.max(0, Math.min(isNaN(n) ? 0 : n, 999)));
                if (v !== lastFish) { lastFish = v; post('fish', v); }
              }
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mq-fish'], subtree: true });
          }
          const css = document.createElement('style');
          // The token gate is web UI; the native app states privacy itself.
          css.textContent = '.private-gate{display:none!important}' +
            '*{-webkit-user-select:none!important;-webkit-touch-callout:none!important}';
          (document.head || document.documentElement).appendChild(css);
        })();
        """
    }

    /// The server's own shape for a channel token (`^isk_[A-Za-z0-9_-]+$`),
    /// checked per character. Not a regex on purpose: `$` also matches before a
    /// trailing newline, so "isk_abc\n" would pass one.
    static func isWellFormed(_ token: String) -> Bool {
        guard token.hasPrefix("isk_"), token.count > 4 else { return false }
        return token.unicodeScalars.allSatisfy { scalar in
            scalar.isASCII && (CharacterSet.alphanumerics.contains(scalar) || scalar == "_" || scalar == "-")
        }
    }

    // MARK: Coordinator

    /// Two roles. As a web view's delegate ("host") it records what the page
    /// has said — so a pooled page can be replayed to its next owner — and
    /// forwards each event to `sink` (the coordinator of the view currently
    /// showing it), or to itself when it is its own view's coordinator.
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let baseURL: URL
        var onFrame: (String) -> Void
        var onFailure: () -> Void
        var onAssets: ((Int) -> Void)?
        var onPinned: (() -> Void)?
        var onFish: ((Int) -> Void)?
        var onReused: (() -> Void)?
        var sawFrame = false
        var loaded: (String, Int) = ("", -1)
        /// Set on a host whose page is being shown by another view.
        weak var sink: Coordinator?
        /// The host delegate of the web view this coordinator's view shows.
        var host: Coordinator?
        var poolKey: WebScenePool.Key?
        private(set) var lastFrame: String?
        private(set) var lastAssets: Int?
        private(set) var lastFish: Int?
        private(set) var painted = false
        private var out: Coordinator { sink ?? self }
        var snapshotTask: Task<Void, Never>?

        /// Keep `WebScenePool`'s picture of this page fresh while it is on
        /// screen, so the next swipe back to it slides in showing the scene.
        /// Only once the page shows the RIGHT thing: a history page's socket
        /// carries the live scene until its pinned one has drawn.
        func startSnapshots(of webView: WKWebView, channelId: String, sceneId: Int?) {
            snapshotTask?.cancel()
            snapshotTask = Task { @MainActor [weak self, weak webView] in
                try? await Task.sleep(for: .seconds(1.2))
                while !Task.isCancelled {
                    guard let self, let webView else { return }
                    let host = self.host ?? self
                    let showing = sceneId == nil ? host.lastFrame != nil : host.painted
                    if showing, webView.window != nil, webView.bounds.width > 0 {
                        let config = WKSnapshotConfiguration()
                        config.snapshotWidth = NSNumber(value: Double(webView.bounds.width / 2))
                        if let image = try? await webView.takeSnapshot(configuration: config), !Task.isCancelled {
                            WebScenePool.shared.storeSnapshot(image, channelId: channelId, sceneId: sceneId)
                        }
                    }
                    try? await Task.sleep(for: .seconds(3))
                }
            }
        }

        init(baseURL: URL, onFrame: @escaping (String) -> Void, onFailure: @escaping () -> Void) {
            self.baseURL = baseURL
            self.onFrame = onFrame
            self.onFailure = onFailure
        }

        func userContentController(_ controller: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard let payload = message.body as? [String: Any],
                  let kind = payload["kind"] as? String,
                  let body = payload["body"] as? String else { return }
            switch kind {
            case "frame":
                if !sawFrame { sawFrame = true; SwipeTiming.mark("first socket frame") }
                lastFrame = body
                out.onFrame(body)
            // A count, clamped: the page is untrusted, and this only ever
            // decides how long a loading animation plays.
            case "assets":
                if let n = Int(body) { lastAssets = max(0, min(n, 99)); SwipeTiming.mark("assets pending \(n)"); out.onAssets?(lastAssets!) }
            case "fish":
                if let n = Int(body) {
                    lastFish = max(0, min(n, 999))
                    SwipeTiming.mark("fish \(lastFish!)")
                    out.onFish?(lastFish!)
                }
            case "pinned":
                SwipeTiming.mark("pinned scene painted")
                painted = true
                out.onPinned?()
            default: break
            }
        }

        /// The page may move between channels (a paired push does), and
        /// nowhere else. Anything that would turn this surface into a browser
        /// is refused. Pinned to `baseURL` (scheme + host), never to the
        /// webview's currently loaded URL: that URL is nil during the first
        /// provisional navigation and is itself attacker-controlled after a
        /// redirect, so either would let a hostile origin's own scripts run
        /// with the bootstrap token seeded into `localStorage`.
        // The handler's exact type matters: WebKit's SDK declares it
        // `@MainActor @Sendable`. Without those this method only "nearly
        // matches" the delegate requirement — a WARNING, not an error — and
        // WebKit never calls it, leaving the surface free to navigate anywhere.
        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard action.targetFrame?.isMainFrame != false else { return decisionHandler(.allow) }
            let url = action.request.url
            let sameOrigin = url?.scheme == baseURL.scheme && url?.host == baseURL.host
                && url?.port == baseURL.port
            let isChannel = url?.path.hasPrefix("/channel/") == true
            decisionHandler(sameOrigin && isChannel ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) { out.onFailure() }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                     withError error: Error) { out.onFailure() }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { SwipeTiming.mark("page committed") }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { SwipeTiming.mark("page loaded") }

        /// WebKit renders out of process. A scene heavy enough to kill its
        /// renderer kills THAT process — the app survives, and asks again.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }
}

/// `WKUserContentController` retains its handlers strongly; without this the
/// coordinator, the web view and the page would keep each other alive.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

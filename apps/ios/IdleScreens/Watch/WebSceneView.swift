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
///
/// A swipe to another public channel does not load a page: it takes the warm
/// one just left and switches it in place (`Coordinator.retarget`), the way
/// the site itself switches channel — no reload, no second socket.
///
/// **The bridge's trust, stated exactly.** The tap and the message handler
/// live in the page's own JS world (the tap has to: an isolated
/// `WKContentWorld` gets its own `WebSocket` and never sees the page's), so
/// page script can post to the handler directly and the page's word is only
/// as good as the page — which is why navigation is pinned to `baseURL`'s
/// `/channel/` paths. What native guarantees on top of that: WHICH channel's
/// frames count is native state (`Coordinator.channelId`), set only by Swift
/// (`init`, `retarget`). The page reports which socket a frame came from;
/// nothing it sends can change which socket is listened to. There is no JS
/// entry point to retarget, so there is nothing for page script to call.
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
    /// Fish a 3D tank has spawned so far, and the cast it is filling toward
    /// when the page says (nil from a site older than metaquarium 0.18.1).
    var onFish: ((Int, Int?) -> Void)? = nil
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
        let coordinator = Coordinator(channelId: channelId, baseURL: baseURL, onFrame: onFrame, onFailure: onFailure)
        coordinator.onAssets = onAssets
        coordinator.onPinned = onPinned
        coordinator.onFish = onFish
        return coordinator
    }

    var poolKey: WebScenePool.Key {
        WebScenePool.Key(channelId: channelId, sceneId: sceneId, keyed: token != nil)
    }

    func makeUIView(context: Context) -> SceneHostView {
        let container = SceneHostView()
        let coordinator = context.coordinator
        container.coordinator = coordinator
        container.show(attach(coordinator))
        // A public live page on screen is what the next channel flipped to
        // takes over (`WebScenePool.handOver`).
        if poolable, token == nil, sceneId == nil { WebScenePool.shared.showing(container) }
        return container
    }

    /// The web view this view shows: a warm one from the pool, the page of
    /// the channel just left switched in place, or a new one.
    private func attach(_ coordinator: Coordinator) -> WKWebView {
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
                if let fish = host.lastFish { coordinator.onFish?(fish, host.lastWant) }
                if host.painted { coordinator.onPinned?() }
                if host.lastFrame != nil || host.painted { coordinator.onReused?() }
            }
            coordinator.startSnapshots(of: webView, channelId: channelId, sceneId: sceneId)
            return webView
        }
        // A channel flip: switch the live page just left to this channel
        // instead of loading one. Public, live pages only — a keyed page has
        // its own store and token, and a pinned scene is its own document.
        // SwiftUI builds this view BEFORE it dismantles the page being left
        // (measured 2026-10-25), so that page is usually still on screen:
        // take it from there; if it has already been parked, from the pool.
        if poolable, token == nil, sceneId == nil,
           let (webView, host) = WebScenePool.shared.handOver(forChannel: channelId)
                ?? WebScenePool.shared.adopt(forChannel: channelId) {
            SwipeTiming.mark("web view adopted from \(host.channelId)")
            host.sink = coordinator
            coordinator.host = host
            host.retarget(webView, to: channelId)
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

        let webView = FullBleedWebView(frame: .zero, configuration: config)
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

    func updateUIView(_ container: SceneHostView, context: Context) {
        context.coordinator.onFrame = onFrame
        context.coordinator.onAssets = onAssets
        context.coordinator.onPinned = onPinned
        context.coordinator.onFish = onFish
        context.coordinator.onReused = onReused
        context.coordinator.onFailure = onFailure
        guard let webView = container.webView,
              context.coordinator.loaded != (channelId, reloadCount) else { return }
        context.coordinator.loaded = (channelId, reloadCount)
        webView.load(URLRequest(url: Self.sceneURL(baseURL: baseURL, channelId: channelId, sceneId: sceneId)))
    }

    static func dismantleUIView(_ container: SceneHostView, coordinator: Coordinator) {
        coordinator.snapshotTask?.cancel()
        WebScenePool.shared.notShowing(container)
        // Handed over to the next channel's view: not ours to park or stop.
        guard let webView = container.release() else { return }
        let host = coordinator.host ?? coordinator
        host.sink = nil
        SwipeTiming.mark("web view dismantled (\(host.channelId))")
        if let key = coordinator.poolKey {
            WebScenePool.shared.park(key, webView: webView, host: host)
        } else {
            WebScenePool.teardown(webView)
        }
    }

    // MARK: Page bootstrap

    static let handlerName = "idleHost"

    /// Run by native (never by the page) to switch a page in place: push the
    /// channel's address, let the site's `popstate` handler remount its
    /// viewer, then resolve once the new channel's canvas has drawn — the
    /// first canvas under `#screen` that is not the one that was there, two
    /// animation frames on. False after 2.5 s without one. The path arrives
    /// as an argument, never spliced into the source.
    static let switchScript = """
    const old = document.querySelector('#screen canvas');
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    return await new Promise((resolve) => {
      const until = Date.now() + 2500;
      const frames = (n) => n === 0 ? resolve(true) : requestAnimationFrame(() => frames(n - 1));
      const check = () => {
        const c = document.querySelector('#screen canvas');
        if (c && c !== old) { frames(2); setTimeout(() => resolve(true), 120); return; }
        if (Date.now() > until) { resolve(false); return; }
        setTimeout(check, 16);
      };
      check();
    });
    """

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
          const post = (kind, body, socket) => {
            try { window.webkit.messageHandlers.\(handlerName).postMessage(socket ? { kind, body, socket } : { kind, body }); } catch (_) {}
          };
          // Only channel sockets are instrumented, and each frame says which
          // channel's socket it came from: native decides which one counts
          // (see the struct's doc). A page that opens some OTHER socket
          // (telemetry, an embed, or one on a spoofed origin) never has its
          // frames posted. Origin (protocol+host+port) must match exactly, and
          // the path must be a whole channel socket path; a suffix alone would
          // let wss://attacker.example/anything/c/<id>/ws slip through.
          // Deliberately NOT one channel: a page switched to another channel
          // in place (retarget) keeps this document, and with it this tap.
          const channelSocketProtocol = \(literal(wsProtocol));
          const channelSocketHost = \(literal(wsHost));
          const channelSocketPort = \(literal(wsPort));
          const channelSocketPath = /^\\/c\\/[A-Za-z0-9_-]{1,64}\\/ws$/;
          const channelSocket = (url) => {
            try {
              const u = new URL(url, location.href);
              return u.protocol === channelSocketProtocol
                && u.hostname === channelSocketHost
                && u.port === channelSocketPort
                && channelSocketPath.test(u.pathname) ? u.pathname : null;
            } catch (_) { return null; }
          };
          const Native = window.WebSocket;
          if (Native && !Native.__idleTapped) {
            const Tapped = function (url, protocols) {
              const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
              const socket = channelSocket(url);
              if (socket) {
                ws.addEventListener('message', (e) => { if (typeof e.data === 'string') post('frame', e.data, socket); });
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
          // A 3D tank's own word on its cast, from its host: data-mq-fish (fish
          // spawned so far) and data-mq-want (the cast it is filling toward,
          // metaquarium 0.18.1+). Its models are bundled now, so the fetch tap
          // above rarely sees one. Clamped integers only.
          if (window.MutationObserver && !window.__idleFishWatch) {
            window.__idleFishWatch = true;
            const count = (el, name) => {
              const n = parseInt(el.getAttribute(name) || '0', 10);
              return String(Math.max(0, Math.min(isNaN(n) ? 0 : n, 999)));
            };
            let lastFish = null, lastWant = null;
            new MutationObserver((records) => {
              for (const r of records) {
                const want = count(r.target, 'data-mq-want');
                const fish = count(r.target, 'data-mq-fish');
                // Want first: the app judges each fish count against it.
                if (want !== lastWant) { lastWant = want; post('want', want); }
                if (fish !== lastFish) { lastFish = fish; post('fish', fish); }
              }
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mq-fish', 'data-mq-want'], subtree: true });
          }
          const css = document.createElement('style');
          // The token gate is web UI; the native app states privacy itself.
          // So is the site's own channel-flip cover: on a switch in place
          // (retarget) the native still already covers, and the web one would
          // slide the outgoing channel's frame over the incoming card.
          css.textContent = '.private-gate{display:none!important}' +
            '.vcover{display:none!important}' +
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
        /// The channel whose socket's frames are this page's state. Native
        /// state, and only native code moves it (`retarget`): a frame from any
        /// other channel's socket — the old one still closing after a switch,
        /// or one the page opened itself — is dropped, whatever it says.
        private(set) var channelId: String
        let baseURL: URL
        var onFrame: (String) -> Void
        var onFailure: () -> Void
        var onAssets: ((Int) -> Void)?
        var onPinned: (() -> Void)?
        var onFish: ((Int, Int?) -> Void)?
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
        private(set) var lastWant: Int?
        private(set) var painted = false
        /// Switched to `channelId` in place and not yet drawn it: what the page
        /// shows is still the channel it left (or nothing).
        private(set) var switching = false
        private var switchGeneration = 0
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
                    let showing = sceneId == nil ? host.lastFrame != nil && !host.switching : host.painted
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

        init(channelId: String, baseURL: URL, onFrame: @escaping (String) -> Void, onFailure: @escaping () -> Void) {
            self.channelId = channelId
            self.baseURL = baseURL
            self.onFrame = onFrame
            self.onFailure = onFailure
        }

        static func socketPath(_ channelId: String) -> String { "/c/\(channelId)/ws" }

        /// Move this page to another channel without loading anything: the
        /// site switches channel on `popstate` (ChannelViewer), dropping the
        /// old channel's socket and opening the new one's in the same
        /// document. Native-only by construction — it is Swift calling
        /// WebKit; the page has no way to invoke it or to change `channelId`.
        ///
        /// Everything this page remembered belongs to the channel it left, so
        /// it is forgotten first: replaying it would show the next view the
        /// old channel's state. The page announces the new channel's first
        /// drawn frame by resolving the switch, and that is when the view is
        /// told it is reused (`onReused`) — never on the old channel's pixels.
        func retarget(_ webView: WKWebView, to channelId: String) {
            self.channelId = channelId
            sawFrame = false
            lastFrame = nil
            lastAssets = nil
            lastFish = nil
            lastWant = nil
            painted = false
            switching = true
            switchGeneration += 1
            let generation = switchGeneration
            // A later load of this view (process restart, the native retry, the
            // site's own stale-bundle reload) must boot for THIS channel.
            let controller = webView.configuration.userContentController
            controller.removeAllUserScripts()
            controller.addUserScript(WKUserScript(
                source: WebSceneView.bootstrapScript(channelId: channelId, token: nil, baseURL: baseURL),
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let url = WebSceneView.sceneURL(baseURL: baseURL, channelId: channelId)
            let path = url.path + "?" + (url.query ?? "")
            Task { @MainActor [weak self, weak webView] in
                let drawn = try? await webView?.callAsyncJavaScript(
                    WebSceneView.switchScript, arguments: ["path": path], in: nil, contentWorld: .page)
                guard let self, let webView, generation == self.switchGeneration else { return }
                self.switching = false
                if drawn as? Bool == true || self.sawFrame {
                    SwipeTiming.mark("switched in place, drawn")
                    self.out.onReused?()
                } else {
                    // The page never switched (a site too old to, or a broken
                    // page): load the channel the ordinary way.
                    SwipeTiming.mark("switch in place failed, loading")
                    webView.load(URLRequest(url: url))
                }
            }
        }

        func userContentController(_ controller: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            receive(message.body)
        }

        /// Everything the page says comes through here (split out so tests can
        /// speak as the page without a web view).
        func receive(_ message: Any) {
            guard let payload = message as? [String: Any],
                  let kind = payload["kind"] as? String,
                  let body = payload["body"] as? String else { return }
            switch kind {
            case "frame":
                // This channel's socket only. A frame from any other socket —
                // the channel just left, still closing — is not this channel.
                guard payload["socket"] as? String == Self.socketPath(channelId) else { return }
                if !sawFrame { sawFrame = true; SwipeTiming.mark("first socket frame") }
                lastFrame = body
                out.onFrame(body)
            // A count, clamped: the page is untrusted, and this only ever
            // decides how long a loading animation plays.
            case "assets":
                if let n = Int(body) { lastAssets = max(0, min(n, 99)); SwipeTiming.mark("assets pending \(n)"); out.onAssets?(lastAssets!) }
            case "fish", "want":
                guard let n = Int(body) else { break }
                if kind == "fish" { lastFish = max(0, min(n, 999)) } else { lastWant = max(0, min(n, 999)) }
                SwipeTiming.mark("fish \(lastFish ?? 0)/\(lastWant.map(String.init) ?? "?")")
                out.onFish?(lastFish ?? 0, lastWant)
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

/// What `WebSceneView` hands SwiftUI: a plain view holding the web view, so
/// the web view can move to another view while this one is still mounted.
/// SwiftUI owns this container and removes it whenever it likes; the web view
/// inside is ours, and goes where the page goes (`WebScenePool.handOver`).
final class SceneHostView: UIView {
    private(set) var webView: WKWebView?
    /// The coordinator of the view this container belongs to.
    weak var coordinator: WebSceneView.Coordinator?

    init() {
        super.init(frame: .zero)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unused") }

    func show(_ webView: WKWebView) {
        self.webView = webView
        webView.frame = bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(webView)
    }

    /// Give the web view up; the container is empty from here on.
    func release() -> WKWebView? {
        let out = webView
        webView = nil
        out?.removeFromSuperview()
        return out
    }
}

/// A web view that reports no safe area, so the page lays the scene out edge
/// to edge. Sideways on a phone WebKit otherwise held the scene inside the
/// notch insets, ~80 pt black bars down both sides. The native chrome above it
/// clears the Dynamic Island itself.
final class FullBleedWebView: WKWebView {
    override var safeAreaInsets: UIEdgeInsets { .zero }
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

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
        Coordinator(baseURL: baseURL, onFrame: onFrame, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
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
        controller.add(WeakScriptHandler(context.coordinator), name: Self.handlerName)
        controller.addUserScript(WKUserScript(
            source: Self.bootstrapScript(channelId: channelId, token: token),
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
        webView.navigationDelegate = context.coordinator

        context.coordinator.loaded = (channelId, reloadCount)
        webView.load(URLRequest(url: Self.sceneURL(baseURL: baseURL, channelId: channelId, sceneId: sceneId)))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onFrame = onFrame
        context.coordinator.onFailure = onFailure
        guard context.coordinator.loaded != (channelId, reloadCount) else { return }
        context.coordinator.loaded = (channelId, reloadCount)
        webView.load(URLRequest(url: Self.sceneURL(baseURL: baseURL, channelId: channelId, sceneId: sceneId)))
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: handlerName)
    }

    // MARK: Page bootstrap

    static let handlerName = "idleHost"

    /// Runs before any page script. Three jobs: seed the token, tap the socket,
    /// and switch off the two behaviours that make a web view feel like one.
    ///
    /// Values are embedded as JSON literals — never string-concatenated — and
    /// the token is re-validated against the server's own pattern first, so a
    /// malformed Keychain value cannot become script.
    static func bootstrapScript(channelId: String, token: String?) -> String {
        func literal(_ value: String) -> String {
            let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
            let array = String(decoding: data, as: UTF8.self)
            return String(array.dropFirst().dropLast())
        }
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
          // some OTHER socket (telemetry, an embed) must never have its
          // frames posted here — ChannelSession treats matching JSON as
          // authoritative state, so an unrelated socket could spoof it.
          const channelSocketSuffix = \(literal("/c/" + channelId + "/ws"));
          const isChannelSocket = (url) => {
            try { return new URL(url, location.href).pathname.endsWith(channelSocketSuffix); }
            catch (_) { return false; }
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let baseURL: URL
        var onFrame: (String) -> Void
        var onFailure: () -> Void
        var loaded: (String, Int) = ("", -1)

        init(baseURL: URL, onFrame: @escaping (String) -> Void, onFailure: @escaping () -> Void) {
            self.baseURL = baseURL
            self.onFrame = onFrame
            self.onFailure = onFailure
        }

        func userContentController(_ controller: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard let payload = message.body as? [String: Any],
                  payload["kind"] as? String == "frame",
                  let frame = payload["body"] as? String else { return }
            onFrame(frame)
        }

        /// The page may move between channels (a paired push does), and
        /// nowhere else. Anything that would turn this surface into a browser
        /// is refused. Pinned to `baseURL` (scheme + host), never to the
        /// webview's currently loaded URL: that URL is nil during the first
        /// provisional navigation and is itself attacker-controlled after a
        /// redirect, so either would let a hostile origin's own scripts run
        /// with the bootstrap token seeded into `localStorage`.
        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.targetFrame?.isMainFrame != false else { return decisionHandler(.allow) }
            let url = action.request.url
            let sameOrigin = url?.scheme == baseURL.scheme && url?.host == baseURL.host
                && url?.port == baseURL.port
            let isChannel = url?.path.hasPrefix("/channel/") == true
            decisionHandler(sameOrigin && isChannel ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) { onFailure() }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                     withError error: Error) { onFailure() }

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

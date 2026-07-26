import SwiftUI
import WebKit

/// Full-screen viewer for a channel — embeds the hosted viewer page.
/// Transparent webview over the app background (no white flash), spinner
/// until the page paints, and the idle timer is suspended while watching —
/// a screensaver viewer must not get interrupted by the phone's own sleep.
struct ChannelViewerView: View {
    let channelId: String
    var label: String?
    @Environment(AppState.self) private var app
    @State private var isLoading = true

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()
            WebView(url: app.gallery.viewerURL(for: channelId), isLoading: $isLoading)
                .ignoresSafeArea(edges: .bottom)
            if isLoading {
                ProgressView()
                    .tint(.appPrimary)
                    .controlSize(.large)
            }
        }
        .navigationTitle(label ?? channelId)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.appBackground, for: .navigationBar)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

private struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isLoading: $isLoading)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var isLoading: Bool

        init(isLoading: Binding<Bool>) {
            _isLoading = isLoading
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }
    }
}

import SwiftUI
import WebKit

/// Full-screen viewer for a channel — embeds the hosted viewer page.
struct ChannelViewerView: View {
    let channelId: String
    var label: String?
    @Environment(AppState.self) private var app

    var body: some View {
        WebView(url: app.gallery.viewerURL(for: channelId))
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(label ?? channelId)
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

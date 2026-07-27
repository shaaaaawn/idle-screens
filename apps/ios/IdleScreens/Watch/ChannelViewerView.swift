import SwiftUI
import WebKit

/// Full-screen channel viewer. Renders the scene **natively** from the live
/// socket (same renderer as the tvOS app and the gallery previews) rather
/// than embedding the website — instant first frame, no browser chrome, no
/// page-load flash. The hosted page is kept only as the fallback for classic
/// savers, which have no native representation.
struct ChannelViewerView: View {
    let channelId: String
    var label: String?
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var session = ChannelSession()
    @State private var showChrome = true
    @State private var chromeTask: Task<Void, Never>?

    private var seedSpec: SpecSubset? {
        app.channels.first { $0.id == channelId }?.spec
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if session.isClassicSpec {
                // Classic savers live only on the web engine.
                HostedViewer(url: app.gallery.viewerURL(for: channelId))
                    .ignoresSafeArea()
            } else if session.hasScene {
                NativeSceneView(
                    layers: session.compiledScene,
                    background: session.background,
                    tier: .t3
                )
                .ignoresSafeArea()
                .opacity(session.sleeping ? 0 : 1)
                .animation(.easeInOut(duration: 0.6), value: session.sleeping)
            } else {
                ProgressView()
                    .tint(.white)
                    .controlSize(.large)
            }

            if session.sleeping {
                VStack(spacing: 12) {
                    Image(systemName: "moon.zzz")
                        .font(.system(size: 34))
                    Text("channel is sleeping")
                        .font(.subheadline)
                }
                .foregroundStyle(Color.textSecondary.opacity(0.5))
            }

            // VJ overlay text, flashed to every viewer.
            if let overlay = session.overlayText {
                Text(overlay)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 14)
                    .background(.black.opacity(0.55), in: Capsule())
                    .transition(.opacity)
            }

            // Chrome fades out so the scene owns the screen; tap to bring back.
            if showChrome {
                VStack {
                    HStack(spacing: 12) {
                        Button { dismiss() } label: {
                            Image(systemName: "chevron.left")
                                .font(.headline)
                                .foregroundStyle(.white)
                                .padding(10)
                                .background(.black.opacity(0.45), in: Circle())
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(label ?? channelId)
                                .font(.headline)
                                .foregroundStyle(.white)
                            if let scene = session.sceneLabel {
                                Text(scene)
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                        }
                        Spacer()
                        if let viewers = session.viewers, viewers > 0 {
                            Label("\(viewers)", systemImage: "eye.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(.black.opacity(0.45), in: Capsule())
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    Spacer()
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden(!showChrome)
        .contentShape(Rectangle())
        .onTapGesture { revealChrome() }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar, .tabBar)
        .animation(.easeInOut(duration: 0.25), value: showChrome)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            session.start(channelId: channelId, seedSpec: seedSpec)
            revealChrome()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            chromeTask?.cancel()
            session.stop()
        }
    }

    /// Show the chrome, then auto-hide after a beat of no interaction.
    private func revealChrome() {
        showChrome = true
        chromeTask?.cancel()
        chromeTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            showChrome = false
        }
    }
}

/// WKWebView fallback for classic savers — transparent over black so there
/// is no white flash while the page paints.
private struct HostedViewer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

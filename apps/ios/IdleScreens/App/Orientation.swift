import SwiftUI
import UIKit

/// Which way the app may turn, decided per window.
///
/// The player rotates, the rest does not — the YouTube rule. While a channel
/// feed is on screen any iPhone may turn it sideways and the scene goes full
/// screen; leave the feed and a sideways phone turns back to portrait.
/// Browsing (Channels, Agents, Settings) stays portrait on a phone.
///
/// A screen with room for it — an iPad, or a foldable's unfolded inner
/// display (the iPhone Duo's is 669 × 951 pt, natively landscape) — turns
/// everywhere. Measured by the short side, so it follows a fold: the Duo's
/// 466 pt cover screen is a phone.
@MainActor
enum OrientationPolicy {
    /// Feeds on screen right now (a feed pushed over the Watch tab's makes two).
    private static var feeds = 0

    /// The short side at which a screen counts as roomy enough to turn freely.
    static let roomyShortSide: CGFloat = 600

    static func feedAppeared() { feeds += 1; if feeds == 1 { refresh() } }
    static func feedDisappeared() { feeds = max(0, feeds - 1); if feeds == 0 { refresh() } }

    static func mask(for window: UIWindow?) -> UIInterfaceOrientationMask {
        if UIDevice.current.userInterfaceIdiom == .pad { return .all }
        if feeds > 0 { return .allButUpsideDown }
        let bounds = window?.windowScene?.screen.bounds ?? UIScreen.main.bounds
        return min(bounds.width, bounds.height) >= roomyShortSide ? .allButUpsideDown : .portrait
    }

    /// Ask every window to re-read its mask. A sideways phone whose mask no
    /// longer allows sideways turns back to portrait on its own.
    static func refresh() {
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            for window in scene.windows {
                window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated { OrientationPolicy.mask(for: window) }
    }
}

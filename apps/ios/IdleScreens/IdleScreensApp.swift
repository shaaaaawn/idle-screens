import SwiftUI
import UIKit

@main
struct IdleScreensApp: App {
    /// Only for `supportedInterfaceOrientationsFor:` — see `OrientationPolicy`.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .onOpenURL { url in
                    // A handoff link carries BOTH a channel and a token, so it
                    // is checked first — a pair code never has a token, and
                    // silently treating a grant of control as a pairing
                    // attempt would drop the token on the floor.
                    if let grant = ChannelTokenFormat.handoff(from: url) {
                        Task {
                            try? await appState.addExistingChannel(
                                channelId: grant.channelId, token: grant.token)
                        }
                        return
                    }
                    // Universal link https://idlescreens.com/pair/<code> or
                    // custom scheme idlescreens://pair/<code>.
                    if let code = AppState.pairCode(from: url) {
                        Task { await appState.claimPairCode(code) }
                    }
                }
                .task {
                    // Crash/hang capture: MetricKit delivers the previous
                    // run's diagnostics shortly after launch.
                    CrashReporter.shared.start()
                    if ProcessInfo.processInfo.arguments.contains("-print-diagnostics") {
                        CrashReporter.shared.printReports()
                    }

                    // Debug affordance (CLI testing, mirrors the TV's -channel):
                    // `simctl launch booted <id> -pair <code>` claims a pair
                    // code headlessly; `-push <channel>` pushes to the TV.
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-pair"), args.indices.contains(i + 1) {
                        await appState.claimPairCode(args[i + 1])
                    }
                    if let i = args.firstIndex(of: "-push"), args.indices.contains(i + 1) {
                        await appState.pushToAllScreens(channelId: args[i + 1])
                    }
                    // `-seed-screens` fakes one paired screen per platform so
                    // the Screens tab can be reviewed before the pairing
                    // service is reachable. Debug/QA only — no tokens, so
                    // pushes from these will fail loudly rather than silently.
                    #if DEBUG
                    if args.contains("-seed-screens") {
                        appState.seedDemoScreens()
                    }
                    // `-orientation landscape` turns an iPhone sim sideways
                    // headlessly (simctl has no rotate). iPhone only: iPadOS
                    // refuses programmatic turns for multitasking apps.
                    if let i = args.firstIndex(of: "-orientation"), args.indices.contains(i + 1) {
                        try? await Task.sleep(for: .seconds(1.5))   // after the feed has appeared
                        let mask: UIInterfaceOrientationMask = args[i + 1] == "landscape" ? .landscapeRight : .portrait
                        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
                            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
                                print("[orientation] \(error.localizedDescription)")
                            }
                        }
                    }
                    #endif
                }
        }
        .onChange(of: scenePhase) {
            // Back in front: refresh the wall only if it is stale. Every
            // return used to refetch it, re-rendering the page you came back to.
            if scenePhase == .active,
               appState.galleryLoadedAt.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                Task { await appState.loadGallery() }
            }
        }
    }
}

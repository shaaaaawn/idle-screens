import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The native face of the server's two-step confirm.
///
/// idlescreens.com answers `revokeToken`, `deleteChannel`, `rotateToken`,
/// `createOwnerKey` — and `sleepChannel` while screens are watching — with
/// `confirmation_required` first: a sentence saying exactly what will happen,
/// and a one-time token. `MCPClient.callTool` hands that sentence here; a yes
/// repeats the call with the token, a no sends nothing.
///
/// UIKit rather than a SwiftUI `.alert`: the calls start from inside sheets
/// (the composer, the keyring), and an alert attached anywhere else in the
/// SwiftUI tree cannot present over a sheet. Presenting from the topmost view
/// controller works from any surface, on iPhone, iPad and Apple TV alike.
enum MCPConfirmPrompt {
    /// Title and confirm-button label for a tool's question. The server's
    /// `message` is the body; this only names the action.
    static func labels(for tool: String) -> (title: String, action: String) {
        switch tool {
        case "sleepChannel": ("Pause every screen?", "Pause")
        case "revokeToken": ("Revoke this key?", "Revoke")
        case "deleteChannel": ("Delete this channel?", "Delete")
        case "rotateToken": ("Rotate the owner key?", "Rotate")
        case "createOwnerKey": ("Make an owner key?", "Make key")
        default: ("Are you sure?", "Continue")
        }
    }

    #if canImport(UIKit)
    /// The confirmer the apps install on their `MCPClient`.
    static let confirmer: MCPConfirmer = { request in await ask(request) }

    /// One alert at a time. Two server replies can land back to back (two
    /// revokes started in the keyring); presenting the second while the first
    /// is still opening makes UIKit drop it, and its continuation would never
    /// resume. Later asks wait here until the earlier alert has been answered.
    @MainActor private static var busy = false
    @MainActor private static var waiters: [CheckedContinuation<Void, Never>] = []

    @MainActor
    private static func acquire() async {
        if busy {
            await withCheckedContinuation { waiters.append($0) }
        } else {
            busy = true
        }
    }

    @MainActor
    private static func release() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()   // hand off; `busy` stays true
        }
    }

    @MainActor
    static func ask(_ request: MCPConfirmationRequest) async -> Bool {
        await acquire()
        defer { release() }
        guard let presenter = topViewController() else { return false }
        let (title, action) = labels(for: request.tool)
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title, message: request.message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                continuation.resume(returning: false)
            })
            alert.addAction(UIAlertAction(title: action, style: .destructive) { _ in
                continuation.resume(returning: true)
            })
            presenter.present(alert, animated: true)
        }
    }

    @MainActor
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        var top = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
    #endif
}

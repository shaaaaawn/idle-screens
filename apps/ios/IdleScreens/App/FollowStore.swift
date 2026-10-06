import Foundation
import Observation

/// The channels you follow.
///
/// Deliberately not a server feature. idlescreens.com has no accounts — a
/// follow list keyed to a person would be the first user record, which is
/// exactly what its auth design avoids. So a follow is yours: it lives on your
/// devices and travels between them the same way your channel keys do, through
/// iCloud Keychain. Nobody is told you followed anything, and there is no count.
///
/// (Keychain rather than iCloud key-value storage on purpose: the app already
/// syncs keys this way, and KVS would need an iCloud entitlement and a new
/// provisioning profile for one small set of strings.)
@MainActor @Observable
final class FollowStore {
    private(set) var followed: Set<String>

    /// Where the list is kept. Injected so tests don't touch the Keychain.
    struct Storage {
        var load: () -> [String]?
        var save: ([String]) -> Void
    }

    @ObservationIgnored private let storage: Storage

    init(storage: Storage = .keychainBacked) {
        self.storage = storage
        followed = Set(storage.load() ?? [])
    }

    func isFollowing(_ channelId: String) -> Bool { followed.contains(channelId) }

    /// Returns the new state, so the caller can word its feedback.
    @discardableResult
    func toggle(_ channelId: String) -> Bool {
        let nowFollowing: Bool
        if followed.contains(channelId) {
            followed.remove(channelId)
            nowFollowing = false
        } else {
            followed.insert(channelId)
            nowFollowing = true
        }
        // Sorted, so the stored value is stable and two devices writing the
        // same set write the same bytes.
        storage.save(followed.sorted())
        return nowFollowing
    }

    /// Followed channels that still exist, newest update first — the same
    /// order as the Watch feed, so "Following" is a filter, not a new sort.
    ///
    /// `canRead` mirrors `ChannelFeed.latestFirst`'s own parameter: a private
    /// channel is only offered when it answers true. Defaults permissive so a
    /// caller with no notion of "can this device read it" keeps today's
    /// behaviour; the caller that can answer (a token-aware AppState) should
    /// pass a real predicate rather than rely on the default.
    func channels(in all: [PublicChannel],
                  canRead: (PublicChannel) -> Bool = { _ in true }) -> [PublicChannel] {
        ChannelFeed.latestFirst(all.filter { followed.contains($0.id) }, canRead: canRead)
    }
}

extension FollowStore.Storage {
    private static let key = "follows.v1"

    /// UserDefaults for an instant read at launch; a synchronizable Keychain
    /// item so the list reaches the user's other devices. The Keychain copy
    /// wins when both exist — it is the one another device may have updated.
    /// Last writer wins; for a list of follows that is an acceptable merge.
    static var keychainBacked: FollowStore.Storage {
        FollowStore.Storage(
            load: {
                let raw = KeychainHelper.load(key: key)
                    ?? UserDefaults.standard.string(forKey: key)
                guard let data = raw?.data(using: .utf8) else { return nil }
                return try? JSONDecoder().decode([String].self, from: data)
            },
            save: { ids in
                guard let data = try? JSONEncoder().encode(ids),
                      let raw = String(data: data, encoding: .utf8) else { return }
                UserDefaults.standard.set(raw, forKey: key)
                KeychainHelper.save(key: key, value: raw)
            })
    }
}

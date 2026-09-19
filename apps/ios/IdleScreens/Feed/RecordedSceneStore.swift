import Foundation
import Observation

/// Every past scene the app has fetched, once.
///
/// Three surfaces want the same recorded scene — the page you swipe to, the
/// neighbour being painted ahead of the swipe, and the tile in the channel's
/// zoomed-out timeline. Without a shared store each asks the server separately,
/// and worse, the page you land on starts empty: the "black bar sliding in" is
/// simply a page that has not got its scene yet.
@MainActor @Observable
final class RecordedSceneStore {
    private var scenes: [String: RecordedScene] = [:]
    @ObservationIgnored private var inflight: [String: Task<RecordedScene?, Never>] = [:]
    @ObservationIgnored private var failed: Set<String> = []

    private static func key(_ channelId: String, _ sceneId: Int) -> String { "\(channelId):\(sceneId)" }

    /// Synchronous read — what a view renders from. Observed, so a page
    /// repaints the moment its scene lands.
    func scene(channelId: String, sceneId: Int) -> RecordedScene? {
        scenes[Self.key(channelId, sceneId)]
    }

    func didFail(channelId: String, sceneId: Int) -> Bool {
        failed.contains(Self.key(channelId, sceneId))
    }

    /// Fetch once; concurrent callers share the same request.
    @discardableResult
    func load(channelId: String, sceneId: Int, from gallery: GalleryClient,
              retry: Bool = false) async -> RecordedScene? {
        let key = Self.key(channelId, sceneId)
        if let hit = scenes[key] { return hit }
        if failed.contains(key), !retry { return nil }
        if let running = inflight[key] { return await running.value }

        let task = Task<RecordedScene?, Never> {
            try? await gallery.fetchScene(channelId: channelId, sceneId: sceneId)
        }
        inflight[key] = task
        let result = await task.value
        inflight[key] = nil
        if let result {
            scenes[key] = result
            failed.remove(key)
        } else {
            failed.insert(key)
        }
        return result
    }

    /// Paint the pages either side of where you are before you get there.
    func prefetch(channelId: String, sceneIds: [Int], from gallery: GalleryClient) {
        for sceneId in sceneIds where scenes[Self.key(channelId, sceneId)] == nil {
            Task { await load(channelId: channelId, sceneId: sceneId, from: gallery) }
        }
    }
}

import Foundation

/// The Watch feed's running order, and a channel's history as swipeable stops.
/// Pure functions, because "which channel is first" and "is this stop real" are
/// the two things a feed gets subtly wrong.
enum ChannelFeed {
    /// Latest update first.
    ///
    /// Three adjustments to a plain sort, each because the plain sort puts a
    /// dud page in front of someone flipping through:
    /// - A sleeping channel is a moon and a sentence. It goes to the back
    ///   however recently it was touched.
    /// - A private channel this device holds no token for cannot be read at
    ///   all, so it is not offered.
    /// - Ties break on id, because the API's order is not guaranteed and a
    ///   feed that reshuffles between refreshes loses your place.
    static func latestFirst(_ channels: [PublicChannel],
                            canRead: (PublicChannel) -> Bool = { _ in true }) -> [PublicChannel] {
        channels
            .filter { $0.access != "private" || canRead($0) }
            .sorted { a, b in
                let sa = a.sleeping == true, sb = b.sleeping == true
                if sa != sb { return !sa }
                let la = a.lastEventAt ?? 0, lb = b.lastEventAt ?? 0
                if la != lb { return la > lb }
                return a.id < b.id
            }
    }

    /// One past scene you can swipe to.
    struct Stop: Identifiable, Equatable, Sendable {
        let sceneId: Int
        let event: ChannelEvent
        var id: Int { sceneId }
    }

    /// The channel's past scenes, newest first, ready to page through.
    ///
    /// - Only scene-backed events: an overlay or a `setParam` has no frame to
    ///   return to.
    /// - The scene that is live right now is dropped — it is the page you
    ///   swiped away from, and meeting it again one swipe later reads as a bug.
    /// - A scene recalled or re-scheduled appears once, at its most recent
    ///   airing, so the strip is a list of pictures rather than of log lines.
    /// - Ties on `at` (two events stamped the same millisecond) break on the
    ///   higher event id, so the order doesn't depend on the response order.
    static func stops(from events: [ChannelEvent], limit: Int = 24) -> [Stop] {
        var seen = Set<Int>()
        var out: [Stop] = []
        for event in events.sorted(by: { a, b in a.at != b.at ? a.at > b.at : a.id > b.id }) {
            guard let sceneId = event.sceneId, seen.insert(sceneId).inserted else { continue }
            out.append(Stop(sceneId: sceneId, event: event))
        }
        return Array(out.dropFirst().prefix(limit))
    }
}

/// A recorded control track — mirrors `packages/core/src/types.ts`
/// `ControlTrack`/`ParamDelta`. Carried through so a past scene's steering
/// deltas are available; resolving them into the rendered frame is a
/// renderer-side follow-up (nothing currently reads this field).
struct RecordedControlTrack: Decodable, Equatable, Sendable {
    /// One steering delta. `value` mirrors the server's `ParamValue` union
    /// (number | string | bool).
    enum DeltaValue: Decodable, Equatable, Sendable {
        case number(Double)
        case string(String)
        case bool(Bool)

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let b = try? c.decode(Bool.self) { self = .bool(b); return }
            if let n = try? c.decode(Double.self) { self = .number(n); return }
            self = .string(try c.decode(String.self))
        }
    }

    struct Delta: Decodable, Equatable, Sendable {
        /// ms from track start.
        let t: Double
        /// key in the saver's paramSpace.
        let path: String
        let value: DeltaValue
        let ease: String?
        /// ramp duration ms from the previous value (0 = instant).
        let dur: Double?
    }

    let program: String?
    let seed: Int?
    let duration: Double?
    let loop: Bool?
    let deltas: [Delta]
}

/// A scene as it was published — `GET /c/:id/scene/:sceneId`. Public, and
/// complete: spec, seed and track, which is what makes a past moment
/// re-renderable rather than a screenshot.
struct RecordedScene: Decodable, Equatable, Sendable {
    let id: Int?
    let label: String?
    let seed: Int?
    let publishedAt: Double?
    let author: String?
    /// Drawable schema scene. For a sequence, its first segment.
    let spec: SpecSubset?
    /// Set when the scene is a classic saver document (`{"id": "warp"}`).
    let classicSaverId: String?
    /// The steering performance recorded against this scene, when the scene
    /// carries one. Not yet consumed by the renderer (see the type's doc).
    let track: RecordedControlTrack?

    /// Classic savers whose native port is only a stand-in: the aquarium is a
    /// 2D sketch of a three.js tank, built for the Apple TV (no WebKit there).
    static let webOnlySavers: Set<String> = ["metaquarium"]

    /// Which past scenes the phone draws with the web engine: only the ones it
    /// can merely impersonate. Schema scenes and ported classics re-render
    /// natively and match the site (checked 2026-09-23 against a 3.9 table
    /// scene — pixel-identical in layout, and just as still). A WebView per
    /// history page would cost a live-page reload on every visit for nothing.
    var needsWebEngine: Bool {
        if let classicSaverId { return Self.webOnlySavers.contains(classicSaverId) }
        // Nothing native can draw at all: better the real thing than a caption.
        return spec == nil
    }

    /// A 3D aquarium: mounts empty and fills over 10–20 s, so it gets the
    /// fish-ring loader and waits for its models, not just its first frame.
    var isTank: Bool { classicSaverId.map(Self.webOnlySavers.contains) ?? false }

    private enum CodingKeys: String, CodingKey { case id, label, seed, publishedAt, author, spec, track }
    private struct ClassicProbe: Decodable { let id: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try? c.decodeIfPresent(Int.self, forKey: .id)
        seed = try? c.decodeIfPresent(Int.self, forKey: .seed)
        publishedAt = try? c.decodeIfPresent(Double.self, forKey: .publishedAt)
        author = try? c.decodeIfPresent(String.self, forKey: .author)
        track = try? c.decodeIfPresent(RecordedControlTrack.self, forKey: .track)
        let topLabel = try? c.decodeIfPresent(String.self, forKey: .label)

        // Same precedence the gallery uses: a sequence envelope has no
        // top-level layers, so poster its first segment; then a schema scene;
        // then a classic saver id.
        var scene: SpecSubset?
        if let seq = try? c.decodeIfPresent(SequenceSubset.self, forKey: .spec),
           SequenceSubset.isSequenceDocument(format: seq.format),
           let first = seq.segments.first {
            scene = first.scene
        } else if let plain = try? c.decodeIfPresent(SpecSubset.self, forKey: .spec),
                  !plain.layers.isEmpty {
            scene = plain
        }
        spec = scene
        if scene == nil, let probe = try? c.decodeIfPresent(ClassicProbe.self, forKey: .spec) {
            classicSaverId = probe.id
        } else {
            classicSaverId = nil
        }
        label = topLabel ?? scene?.label ?? classicSaverId
    }
}

extension GalleryClient {
    func fetchScene(channelId: String, sceneId: Int) async throws -> RecordedScene {
        let url = baseURL
            .appendingPathComponent("c").appendingPathComponent(channelId)
            .appendingPathComponent("scene").appendingPathComponent(String(sceneId))
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode,
                                         body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let scene = try? JSONDecoder().decode(RecordedScene.self, from: data) else {
            throw GalleryError.invalidResponse
        }
        return scene
    }
}

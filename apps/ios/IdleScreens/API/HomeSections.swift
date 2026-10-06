import Foundation

/// One shelf on the home screen.
struct HomeSection: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String?
    /// Tags this shelf already says out loud. A "featured" chip on every card
    /// of the Featured row tells you nothing you didn't read two lines above,
    /// so cards drop these and keep the rest.
    let ownedTags: Set<String>
    let channels: [PublicChannel]
}

/// The home screen's running order, as one pure function.
///
/// This is a deliberate port of the web gallery's section builder
/// (`site/src/features/gallery/Gallery.tsx`) so the two surfaces group and
/// order channels identically — someone who learns the wall on the web finds
/// the same shelves in the same order on the TV. Keep them in step: if the
/// running order changes there, change it here.
///
/// The order IS the editorial statement: what we're putting forward, then the
/// corpus, then the curated shelves, then what's new, then the tail. A channel
/// belongs to exactly one section — each pass takes what is left.
enum HomeSections {

    /// A row of one is not a shelf, it's a stranded card. Categories thinner
    /// than this stay in the tail until someone fills them out (web parity).
    static let minimumPerShelf = 3
    /// "Latest" only means anything inside a window; a shelf whose newest
    /// entry is four months old is a lie with a fresh-sounding name.
    static let newWindow: TimeInterval = 14 * 24 * 60 * 60
    static let maximumLatest = 6

    /// Everything the grid needs to draw, in order. The hero is lifted out of
    /// the first section — a TV convention the web has no equivalent for —
    /// so it is never also a card in the rail underneath itself.
    struct Layout: Equatable {
        var hero: PublicChannel?
        var sections: [HomeSection]
    }

    static func layout(channels: [PublicChannel],
                       categories: [ChannelCategory],
                       now: Date = Date()) -> Layout {
        var sections = build(channels: channels, categories: categories, now: now)
        guard let first = sections.first, let hero = first.channels.first else {
            return Layout(hero: nil, sections: sections)
        }
        let remainder = Array(first.channels.dropFirst())
        if remainder.isEmpty {
            sections.removeFirst()
        } else {
            sections[0] = HomeSection(id: first.id, title: first.title,
                                      subtitle: first.subtitle,
                                      ownedTags: first.ownedTags,
                                      channels: remainder)
        }
        return Layout(hero: hero, sections: sections)
    }

    static func build(channels: [PublicChannel],
                      categories: [ChannelCategory],
                      now: Date = Date()) -> [HomeSection] {
        // Featured first, then most-recently-steered. Without the first key
        // the curated channels sink below whatever an agent last touched, so
        // the opening impression is whichever scene happened to be freshest.
        let sorted = channels.sorted { a, b in
            let fa = a.isFeatured ? 1 : 0, fb = b.isFeatured ? 1 : 0
            if fa != fb { return fa > fb }
            let la = a.lastEventAt ?? 0, lb = b.lastEventAt ?? 0
            if la != lb { return la > lb }
            return a.id < b.id   // stable: the API's order is not guaranteed
        }

        var out: [HomeSection] = []
        var taken = Set<String>()

        func take(_ id: String, _ title: String, _ subtitle: String?,
                  owns: Set<String> = [],
                  pick: (PublicChannel) -> Bool) {
            let picked = sorted.filter { !taken.contains($0.id) && pick($0) }
            guard !picked.isEmpty else { return }
            picked.forEach { taken.insert($0.id) }
            out.append(HomeSection(id: id, title: title,
                                   subtitle: subtitle?.isEmpty == true ? nil : subtitle,
                                   ownedTags: owns, channels: picked))
        }

        take("featured", "Featured", "Hand-picked, always open to steer",
             owns: ["featured"]) { $0.isFeatured }

        take("evals", "Evals", "Artist-style studies published by the eval runs",
             owns: ["eval", "style-study"]) { $0.hasAnyTag("eval", "style-study") }

        // Curated shelves slot in after, so a category built in the admin
        // console appears here without a code change. Thin ones never render.
        for category in categories where category.channelIds.count >= minimumPerShelf {
            let ids = Set(category.channelIds)
            take(category.id, category.displayTitle, category.subtitle) {
                ids.contains($0.id)
            }
        }

        // New arrivals — the one shelf nobody curates, and where a visitor
        // finds out the wall is still moving. Sorted by createdAt, NOT by the
        // recency key the rest of the page uses: that one moves whenever
        // anyone touches a channel, so it would just re-list the busiest.
        let cutoff = Int((now.timeIntervalSince1970 - newWindow) * 1000)
        let fresh = sorted
            .filter { !taken.contains($0.id) && ($0.createdAt ?? 0) > cutoff }
            .sorted { ($0.createdAt ?? 0) > ($1.createdAt ?? 0) }
            .prefix(maximumLatest)
        if !fresh.isEmpty {
            fresh.forEach { taken.insert($0.id) }
            out.append(HomeSection(
                id: "latest", title: "Latest",
                subtitle: fresh.count == 1 ? "Newest on the wall"
                                           : "\(fresh.count) newest on the wall",
                ownedTags: [], channels: Array(fresh)))
        }

        let rest = sorted.filter { !taken.contains($0.id) }
        if !rest.isEmpty {
            out.append(HomeSection(id: "other", title: "Other",
                                   subtitle: "\(rest.count) channels",
                                   ownedTags: [], channels: rest))
        }
        return out
    }
}

extension PublicChannel {
    var isFeatured: Bool { tags?.contains("featured") == true }

    func hasAnyTag(_ wanted: String...) -> Bool {
        guard let tags else { return false }
        return wanted.contains { tags.contains($0) }
    }
}

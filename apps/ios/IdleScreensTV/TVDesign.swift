import SwiftUI

/// The 10-foot design system: one type ramp and one spacing rhythm for every
/// TV surface. Both exist because the app had drifted to ~30 hand-picked
/// `.system(size:)` values, several below the sizes Apple's TV guidance calls
/// legible from a couch (29pt body, 25pt secondary), and no two screens
/// agreed on a margin.
enum TV {

    // MARK: Spacing

    /// Horizontal screen margin. Comfortably clear of the 60pt overscan-safe
    /// inset, and wide enough that a focused card's lift never clips.
    static let gutter: CGFloat = 80
    /// Breathing room under the top chrome (the tab bar floats over content).
    static let headerTop: CGFloat = 48
    /// Between shelves — the largest gap on screen, so rows read as separate.
    static let sectionGap: CGFloat = 64
    /// Shelf header → its cards.
    static let headerGap: CGFloat = 28
    /// Between cards. Rows need more than columns: captions sit under each
    /// card, so equal gaps would read as the caption belonging to the row below.
    static let columnGap: CGFloat = 48
    static let rowGap: CGFloat = 56
    /// Poster → its caption. Tight enough to bind them into one object.
    static let captionGap: CGFloat = 16

    // MARK: Shape

    static let cardRadius: CGFloat = 16
    static let heroRadius: CGFloat = 24
    static let panelRadius: CGFloat = 28

    // MARK: Motion

    /// Focus transitions. Fast enough to feel keyed to the remote, slow
    /// enough not to strobe when a swipe runs across a row.
    static let focusAnimation = Animation.easeOut(duration: 0.18)
}

// MARK: - Type ramp

/// Semantic styles, not fixed sizes. On tvOS these resolve to the platform's
/// own 10-foot ramp (largeTitle 76 · title2 57 · headline 38 · callout 31 ·
/// body 29 · caption 25) AND scale with the Larger Text accessibility
/// setting, which hardcoded point sizes silently ignore.
extension Font {
    /// Wordmark and hero titles.
    static let tvDisplay = Font.system(.largeTitle, weight: .bold)
    /// Screen titles inside a surface (pairing, empty states).
    static let tvScreenTitle = Font.system(.title2, weight: .bold)
    /// Shelf headers — the Apple TV row-title weight.
    static let tvShelfTitle = Font.system(.headline, weight: .semibold)
    /// Card titles. Semibold because regular weight thins out on TV panels.
    static let tvCardTitle = Font.system(.body, weight: .semibold)
    /// Lead-in text above a title (category, tags). Always paired with
    /// `.kerning(1.6)` and a secondary color.
    static let tvKicker = Font.system(.caption, weight: .semibold)
    /// Counts, states, timestamps.
    static let tvMeta = Font.system(.caption)
    /// Running text and list values.
    static let tvBody = Font.system(.body)
    /// Supporting text under a title.
    static let tvSubtitle = Font.system(.callout)
}

import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// MARK: - Timeline

struct ScreensEntry: TimelineEntry {
    let date: Date
    let snapshot: RemoteSnapshot?
    /// The screen this widget steers; nil = the screens you last chose in
    /// the app (`RemoteSnapshot.defaultTargets`).
    let screen: ScreenEntity?
    /// A still of each channel by id: its rendered link card, else a raster
    /// thumb. A tile with neither draws its own art.
    let thumbs: [String: UIImage]
    /// The last send's line, while it is fresh.
    let status: SendOutcome?
}

struct ScreensProvider: AppIntentTimelineProvider {
    /// How long "On 2 screens" stays up after a send.
    static let statusSeconds: TimeInterval = 20

    func placeholder(in context: Context) -> ScreensEntry {
        ScreensEntry(date: Date(), snapshot: .preview, screen: nil, thumbs: [:], status: nil)
    }

    func snapshot(for configuration: ScreensWidgetIntent, in context: Context) async -> ScreensEntry {
        if context.isPreview, RemoteSnapshot.load() == nil {
            return ScreensEntry(date: Date(), snapshot: .preview, screen: nil, thumbs: [:], status: nil)
        }
        return await entry(configuration, family: context.family, at: Date())
    }

    func timeline(for configuration: ScreensWidgetIntent, in context: Context) async -> Timeline<ScreensEntry> {
        let now = Date()
        let first = await entry(configuration, family: context.family, at: now)
        var entries = [first]
        // Clear the send line once it has been read.
        if let sent = first.status {
            let clear = sent.at.addingTimeInterval(Self.statusSeconds)
            entries.append(ScreensEntry(date: clear, snapshot: first.snapshot, screen: first.screen,
                                        thumbs: first.thumbs, status: nil))
        }
        // Screens change channel from elsewhere too; look again in a while.
        return Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60)))
    }

    private func entry(_ configuration: ScreensWidgetIntent, family: WidgetFamily, at now: Date) async -> ScreensEntry {
        let snapshot = RemoteSnapshot.load()
        let status = snapshot?.lastSend.flatMap { now.timeIntervalSince($0.at) < Self.statusSeconds ? $0 : nil }
        let shown = (snapshot?.quickChannels ?? []).prefix(ScreensLayout.tileCount(family)).map(\.id)
        let thumbs = await Self.thumbs(for: Array(shown), base: snapshot?.baseURL)
        return ScreensEntry(date: now, snapshot: snapshot, screen: configuration.screen, thumbs: thumbs, status: status)
    }

    /// A still for each tile. Misses are fine — the tile draws its own art.
    ///
    /// First choice is the channel's link card (`/c/<id>/og.jpg`): a real
    /// render of the scene as a JPEG, which nearly every channel has (56 of 57
    /// listed on 2026-11-18). `/c/<id>/thumb` alone left most tiles on drawn
    /// art, because for a schema channel it is an SVG a widget can't show.
    static func thumbs(for ids: [String], base: String?) async -> [String: UIImage] {
        guard let base, let root = URL(string: base) else { return [:] }
        return await withTaskGroup(of: (String, UIImage?).self) { group in
            for id in ids {
                group.addTask {
                    let channel = root.appendingPathComponent("c").appendingPathComponent(id)
                    if let card = await still(channel.appendingPathComponent("og.jpg")) { return (id, card) }
                    return (id, await still(channel.appendingPathComponent("thumb")))
                }
            }
            var out: [String: UIImage] = [:]
            for await (id, image) in group { if let image { out[id] = image } }
            return out
        }
    }

    /// One raster image at `url`, decoded straight to tile size. A redirect
    /// (a channel with no card is sent to the site's card) or anything that
    /// isn't JPEG/PNG/WebP is a miss.
    static func still(_ url: URL) async -> UIImage? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 6
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.path == url.path,
              let type = http.value(forHTTPHeaderField: "Content-Type"),
              type.hasPrefix("image/jpeg") || type.hasPrefix("image/png") || type.hasPrefix("image/webp")
        else { return nil }
        return TileStill.downsampled(data, maxPixels: 400)
    }
}

// MARK: - Widget

struct ScreensWidget: Widget {
    static let kind = "com.hermosalabs.idlescreens.screens"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: ScreensWidgetIntent.self, provider: ScreensProvider()) { entry in
            ScreensWidgetView(entry: entry)
                .containerBackground(for: .widget) { WidgetPalette.ground }
        }
        .configurationDisplayName("Screens")
        .description("Tap a channel to put it on your paired screens.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

enum ScreensLayout {
    static func tileCount(_ family: WidgetFamily) -> Int {
        switch family {
        case .systemSmall: 4
        case .systemMedium: 4
        case .systemLarge: 9
        default: 4
        }
    }
}

enum WidgetPalette {
    /// Screens are dark in either appearance, like the app's Watch tab.
    static let ground = LinearGradient(colors: [Color(red: 0.06, green: 0.06, blue: 0.10), Color(red: 0.04, green: 0.04, blue: 0.06)],
                                       startPoint: .top, endPoint: .bottom)
    static let violet = Color(red: 0.545, green: 0.486, blue: 1.0)
    static let teal = Color(red: 0.369, green: 0.918, blue: 0.831)
}

// MARK: - Views

struct ScreensWidgetView: View {
    let entry: ScreensEntry
    @Environment(\.widgetFamily) private var family

    /// The screens a tap here lights: the one this widget was set to, else
    /// the ones you last chose in the app.
    private var screens: [RemoteSnapshot.Screen] {
        guard let snapshot = entry.snapshot else { return [] }
        let ids = snapshot.targets(for: entry.screen?.id)
        return snapshot.screens.filter { ids.contains($0.deviceId) }
    }

    private var channels: [RemoteSnapshot.Channel] {
        Array((entry.snapshot?.quickChannels ?? []).prefix(ScreensLayout.tileCount(family)))
    }

    var body: some View {
        if entry.snapshot == nil || screens.isEmpty {
            EmptyScreensView(hasSnapshot: entry.snapshot != nil, missingScreen: entry.screen != nil)
        } else if channels.isEmpty {
            EmptyScreensView(hasSnapshot: true, missingScreen: false, noChannels: true)
        } else {
            VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 10) {
                header
                grid
            }
        }
    }

    // What the screens show, or what just happened.
    @ViewBuilder private var header: some View {
        HStack(spacing: 6) {
            if let status = entry.status {
                Image(systemName: status.succeeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(status.succeeded ? WidgetPalette.teal : .orange)
                Text(status.succeeded ? "\(status.channelLabel) · \(status.message)" : status.message)
                    .lineLimit(1)
            } else {
                Image(systemName: screens.count == 1 ? screens[0].icon : "rectangle.on.rectangle")
                    .foregroundStyle(WidgetPalette.violet)
                Text(nowShowing).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .font(family == .systemSmall ? .caption2.weight(.semibold) : .caption.weight(.semibold))
        .foregroundStyle(.white.opacity(0.9))
        .widgetAccentable()
    }

    private var nowShowing: String {
        let label = { (id: String?) in id.flatMap { entry.snapshot?.label(of: $0) } }
        if screens.count == 1 {
            let showing = label(screens[0].channelId)
            if family == .systemSmall { return showing ?? screens[0].label }
            return showing.map { "\(screens[0].label) · \($0)" } ?? screens[0].label
        }
        let shows = Set(screens.compactMap(\.channelId))
        if shows.count == 1, let one = label(shows.first) { return "\(screens.count) screens · \(one)" }
        return "\(screens.count) screens"
    }

    @ViewBuilder private var grid: some View {
        let columns = family == .systemLarge ? 3 : (family == .systemSmall ? 2 : 4)
        let spacing: CGFloat = family == .systemSmall ? 6 : 8
        // Plain rows, every tile the same flexible size: each button's tap
        // area is exactly its tile (a Grid row sent taps to the row above).
        VStack(spacing: spacing) {
            ForEach(Array(stride(from: 0, to: channels.count, by: columns)), id: \.self) { start in
                HStack(spacing: spacing) {
                    ForEach(channels[start..<min(start + columns, channels.count)]) { channel in
                        tile(channel)
                    }
                    // A short last row keeps its tiles the same width as the rest.
                    ForEach(0..<(columns - min(columns, channels.count - start)), id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder private func tile(_ channel: RemoteSnapshot.Channel) -> some View {
        let onScreen = screens.contains { $0.channelId == channel.id }
        let face = ChannelTile(channel: channel, thumb: entry.thumbs[channel.id], onScreen: onScreen,
                               compact: family == .systemSmall)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        if channel.isPrivate, let link = ScreenRemote.appLink(channelId: channel.id, screenId: entry.screen?.id) {
            // Its key is sealed per screen in the app, so the app sends it.
            Link(destination: link) { face }
        } else {
            Button(intent: SendTileIntent(channelId: channel.id, screenId: entry.screen?.id)) { face }
                .buttonStyle(.plain)
        }
    }
}

struct ChannelTile: View {
    let channel: RemoteSnapshot.Channel
    let thumb: UIImage?
    let onScreen: Bool
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 0 : 4) {
            ZStack(alignment: .bottomLeading) {
                // The art never sizes the tile: a poster scaled to fill would
                // otherwise widen its grid column past the widget's edge.
                Color.clear
                    .overlay { art }
                    .clipShape(RoundedRectangle(cornerRadius: compact ? 10 : 8, style: .continuous))
                if compact {
                    Text(channel.label)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.8), radius: 2)
                        .padding(5)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: compact ? 10 : 8, style: .continuous)
                    .strokeBorder(onScreen ? WidgetPalette.teal : .white.opacity(0.08), lineWidth: onScreen ? 2 : 1)
            }
            if !compact {
                HStack(spacing: 3) {
                    if channel.isPrivate { Image(systemName: "lock.fill").font(.system(size: 8)) }
                    Text(channel.label).lineLimit(1)
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(onScreen ? 1 : 0.75))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(onScreen ? "\(channel.label), on screen" : "Show \(channel.label)")
    }

    @ViewBuilder private var art: some View {
        if let thumb {
            Image(uiImage: thumb).resizable().scaledToFill()
        } else {
            TileArt(seed: channel.id)
        }
    }
}

/// A channel's stand-in poster when there is no JPEG: two soft glows on a
/// dark ground, placed and coloured by its id — the app's procedural art,
/// pared down for a widget.
struct TileArt: View {
    let seed: String

    var body: some View {
        let h = Self.hash(seed)
        let palette: [Color] = [WidgetPalette.violet, WidgetPalette.teal, Color(red: 1, green: 0.84, blue: 0.04)]
        let a = palette[Int(h % 3)], b = palette[Int((h / 3) % 3)]
        GeometryReader { geo in
            ZStack {
                LinearGradient(colors: [Color(red: 0.08, green: 0.08, blue: 0.13), Color(red: 0.02, green: 0.02, blue: 0.05)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(colors: [a.opacity(0.75), .clear], center: Self.point(h, 7), startRadius: 0,
                               endRadius: geo.size.width * 0.55)
                RadialGradient(colors: [b.opacity(0.55), .clear], center: Self.point(h, 13), startRadius: 0,
                               endRadius: geo.size.width * 0.4)
                Circle().fill(.white.opacity(0.9))
                    .frame(width: max(3, geo.size.width * 0.05))
                    .position(x: geo.size.width * Self.point(h, 7).x, y: geo.size.height * Self.point(h, 7).y)
            }
        }
    }

    static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 0x811C_9DC5
        for byte in s.utf8 { h = (h ^ UInt32(byte)) &* 0x0100_0193 }
        return h
    }

    static func point(_ h: UInt32, _ salt: UInt32) -> UnitPoint {
        let x = Double((h &* salt) % 1000) / 1000, y = Double(((h >> 8) &* salt) % 1000) / 1000
        return UnitPoint(x: 0.2 + x * 0.6, y: 0.2 + y * 0.6)
    }
}

struct EmptyScreensView: View {
    let hasSnapshot: Bool
    let missingScreen: Bool
    var noChannels = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: noChannels ? "heart" : "tv")
                .font(.title3)
                .foregroundStyle(WidgetPalette.violet)
            Text(title).font(.headline).foregroundStyle(.white)
            Text(detail).font(.caption).foregroundStyle(.white.opacity(0.65))
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "idlescreens://screens"))
    }

    private var title: String {
        if noChannels { return "No channels yet" }
        if missingScreen { return "Screen not found" }
        return hasSnapshot ? "Pair a screen" : "Open idle screens"
    }

    private var detail: String {
        if noChannels { return "Follow a channel in the app and it shows up here." }
        if missingScreen { return "It was unpaired. Edit the widget to pick another." }
        return hasSnapshot ? "Add an Apple TV, Mac or Linux screen in the app, then switch it from here."
            : "Open the app once so this widget can find your screens."
    }
}

extension RemoteSnapshot {
    /// What the widget gallery shows before the app has written anything.
    static let preview = RemoteSnapshot(
        baseURL: "https://idlescreens.com",
        screens: [.init(deviceId: "preview-tv", label: "Apple TV", icon: "appletv", channelId: "fishtank")],
        channels: [
            .init(id: "fishtank", label: "Fishtank", isPrivate: false),
            .init(id: "aurora", label: "Aurora", isPrivate: false),
            .init(id: "koi-pond", label: "Koi pond", isPrivate: false),
            .init(id: "rain-cafe", label: "Rain café", isPrivate: false),
        ],
        writtenAt: Date())
}

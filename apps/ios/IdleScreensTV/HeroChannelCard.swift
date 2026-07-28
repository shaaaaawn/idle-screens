import SwiftUI

/// Full-width cinematic hero for the first featured channel — ~2.35:1,
/// live thumb (or procedural art), label + stats overlaid bottom-left.
struct HeroChannelCard: View {
    let channel: PublicChannel
    /// Fixed height cap (fraction of the remaining viewport, computed by the
    /// caller). When set, it replaces the 2.35:1 aspect so the hero — scrim,
    /// label, pills — always fits above the fold next to header + tab bar.
    var height: CGFloat? = nil
    @Environment(TVAppState.self) private var app

    var body: some View {
        Group {
            // Live scene billboard on canvas-capable hardware (visibility-
            // guarded inside ScenePreviewView); thumb → art otherwise.
            if let spec = channel.spec, app.effectiveTier == .t3 {
                ScenePreviewView(spec: spec, fallbackSeed: channel.id)
                    .background(ProceduralChannelArt(channelId: channel.id))
            } else {
                ThumbImage(url: app.gallery.thumbURL(for: channel.id)) {
                    ProceduralChannelArt(channelId: channel.id)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .modifier(HeroFrame(height: height))
        .clipped()
        .overlay(alignment: .bottomLeading) {
            VStack(alignment: .leading, spacing: 14) {
                // Editorial kicker above the billboard title (ATV+ grammar).
                if let tags = channel.tags?.filter({ $0 != "featured" }), !tags.isEmpty {
                    Text(tags.prefix(3).joined(separator: " · ").uppercased())
                        .font(.system(size: 23, weight: .semibold))
                        .kerning(2.2)
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(1)
                }
                Text(channel.displayLabel)
                    .font(.system(size: 64, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 16) {
                    if let viewers = channel.viewers {
                        Label("\(viewers) watching", systemImage: "eye")
                    }
                    Text("featured")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(Color.appPrimary)
                        .clipShape(Capsule())
                }
                .font(.callout)
                .foregroundStyle(Color.textSecondary)
            }
            .padding(48)
            .background(
                LinearGradient(
                    colors: [.clear, .black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }
}

private struct HeroFrame: ViewModifier {
    let height: CGFloat?
    func body(content: Content) -> some View {
        if let height {
            content.frame(height: height)
        } else {
            content.aspectRatio(2.35, contentMode: .fit)
        }
    }
}

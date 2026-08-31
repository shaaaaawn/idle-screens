import SwiftUI

/// Full-width cinematic hero for the first featured channel — live scene (or
/// procedural art) with the title lockup over it.
struct HeroChannelCard: View {
    let channel: PublicChannel
    /// Fixed height cap (fraction of the remaining viewport, computed by the
    /// caller). When set, it replaces the 2.35:1 aspect so the hero — scrim,
    /// label, pills — always fits above the fold next to header + tab bar.
    var height: CGFloat? = nil
    @Environment(TVAppState.self) private var app

    var body: some View {
        artwork
            .frame(maxWidth: .infinity)
            .modifier(HeroFrame(height: height))
            .clipped()
            .overlay(scrim)
            .overlay(alignment: .bottomLeading) { lockup }
            .clipShape(RoundedRectangle(cornerRadius: TV.heroRadius))
    }

    @ViewBuilder private var artwork: some View {
        // Live scene billboard on canvas-capable hardware (visibility-guarded
        // inside ScenePreviewView); native classic port → thumb → art.
        if let spec = channel.spec,
           app.effectiveTier == .t3 || app.effectiveTier == .t2 {
            // Same tier rule as the cards below. Gating the hero at t3 alone
            // meant the largest thing on screen fell back to an upscaled
            // server thumb on exactly the hardware where the small posters
            // under it were still rendering crisp native scenes.
            // It animates only at t3; a static native frame still beats a
            // blurry one, and costs nothing.
            ScenePreviewView(spec: spec, fallbackSeed: channel.id,
                             live: app.effectiveTier == .t3)
                .background(ProceduralChannelArt(channelId: channel.id))
        } else if let kind = ClassicSaverKind.supported(id: channel.classicSaverId),
                  let tier = app.classicRenderTier {
            ClassicSaverView(kind: kind,
                             seed: ClassicSaverKind.seed(forChannel: channel.id),
                             tier: tier,
                             live: false)
        } else {
            ThumbImage(url: app.gallery.thumbURL(for: channel.id)) {
                ProceduralChannelArt(channelId: channel.id)
            }
        }
    }

    /// Two gradients across the WHOLE frame. The scrim used to be the text
    /// block's own background, which drew a hard-edged slab that stopped
    /// mid-artwork — the giveaway that nobody had looked at this from a
    /// couch. Bottom darkens for the lockup; leading carries the left third
    /// so a bright scene can't swallow the title.
    private var scrim: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.35),
                    .init(color: .black.opacity(0.45), location: 0.72),
                    .init(color: .black.opacity(0.85), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.55), location: 0),
                    .init(color: .clear, location: 0.55),
                ],
                startPoint: .leading, endPoint: .trailing
            )
        }
        .allowsHitTesting(false)
    }

    private var lockup: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let kicker {
                Text(kicker)
                    .font(.tvKicker)
                    .kerning(2)
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(1)
            }
            Text(channel.displayLabel)
                .font(.tvDisplay)
                .foregroundStyle(.white)
                .lineLimit(1)
            HStack(spacing: 16) {
                if let viewers = channel.viewers, viewers > 0 {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.appAccent)
                            .frame(width: 12, height: 12)
                        Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
                    }
                    .foregroundStyle(.white.opacity(0.85))
                }
                Text("Featured")
                    .font(.tvKicker)
                    .kerning(1.2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    // Glass, not a flat chip: it sits on moving artwork, which
                    // is exactly what the material is for.
                    .glassBadge(tint: Color.appPrimary, shape: Capsule())
            }
            .font(.tvSubtitle)
        }
        .padding(56)
        .accessibilityElement(children: .combine)
    }

    private var kicker: String? {
        guard let tags = channel.tags?.filter({ $0 != "featured" }), !tags.isEmpty else { return nil }
        return tags.prefix(3).joined(separator: " · ").uppercased()
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

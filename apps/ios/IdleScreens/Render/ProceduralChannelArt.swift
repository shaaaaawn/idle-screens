import SwiftUI

/// Deterministic generative poster art for a channel, seeded by its id.
/// Used anywhere a live thumb is missing — hero, cards. Zero network, instant.
struct ProceduralChannelArt: View {
    let channelId: String

    /// FNV-1a 32-bit hash of the channel id → mulberry32 seed.
    nonisolated static func seed(for channelId: String) -> UInt32 {
        var hash: UInt32 = 0x811C_9DC5
        for byte in channelId.utf8 {
            hash = (hash ^ UInt32(byte)) &* 0x0100_0193
        }
        return hash
    }

    /// Dark backdrop tones (from the app palette + spec examples).
    private static let darks = ["#0A0A0F", "#14141C", "#1D1D28", "#0a1628", "#02030d"]
    /// Glow tones — violet / teal / amber, like the app icon.
    private static let glows = ["#8B7CFF", "#5EEAD4", "#FFD60A"]

    var body: some View {
        Canvas { ctx, size in
            var rng = Mulberry32(seed: Self.seed(for: channelId))
            let rect = CGRect(origin: .zero, size: size)
            let minDim = min(size.width, size.height)

            // Gradient backdrop — 2-3 dark stops.
            let stopCount = 2 + Int(rng.next() * 2)
            var stops: [Gradient.Stop] = []
            for i in 0..<stopCount {
                let color = Self.darks[Int(rng.next() * Double(Self.darks.count))]
                let location = stopCount == 1 ? 0.0 : Double(i) / Double(stopCount - 1)
                stops.append(Gradient.Stop(color: Color(hex: color), location: location))
            }
            ctx.fill(Path(rect), with: .linearGradient(
                Gradient(stops: stops),
                startPoint: CGPoint(x: rect.midX, y: rect.minY),
                endPoint: CGPoint(x: rect.midX, y: rect.maxY)
            ))

            // 2-4 soft radial glows, low alpha.
            let glowCount = 2 + Int(rng.next() * 3)
            for _ in 0..<glowCount {
                let color = Self.glows[Int(rng.next() * Double(Self.glows.count))]
                let cx = (0.15 + rng.next() * 0.7) * size.width
                let cy = (0.15 + rng.next() * 0.7) * size.height
                let r = (0.25 + rng.next() * 0.35) * minDim
                let alpha = 0.25 + rng.next() * 0.25
                let center = CGPoint(x: cx, y: cy)
                ctx.fill(
                    Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)),
                    with: .radialGradient(
                        Gradient(colors: [Color(hex: color).opacity(alpha), .clear]),
                        center: center,
                        startRadius: 0,
                        endRadius: r
                    )
                )
            }

            // 0-2 thin rings.
            let ringCount = Int(rng.next() * 3)
            for _ in 0..<ringCount {
                let color = Self.glows[Int(rng.next() * Double(Self.glows.count))]
                let cx = (0.2 + rng.next() * 0.6) * size.width
                let cy = (0.2 + rng.next() * 0.6) * size.height
                let r = (0.15 + rng.next() * 0.3) * minDim
                let alpha = 0.2 + rng.next() * 0.2
                ctx.stroke(
                    Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)),
                    with: .color(Color(hex: color).opacity(alpha)),
                    lineWidth: 1.5
                )
            }
        }
    }
}

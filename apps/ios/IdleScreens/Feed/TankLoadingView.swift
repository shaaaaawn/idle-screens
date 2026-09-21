import SwiftUI

/// "The tank is filling." Shown over the 2D stand-in while a 3D aquarium boots:
/// three fish swim a ring nose-to-tail — a spinner that belongs in the scene —
/// with bubbles rising through the middle, and a count of the fish still on
/// their way when the page reports one.
///
/// The stand-in tank on its own looks finished, which is the problem: a scene
/// that then swaps to something else reads as a glitch. A fish visibly doing a
/// loading thing makes the wait part of the picture.
struct TankLoadingView: View {
    /// Models the page is still downloading; nil until it has said anything.
    var pending: Int?
    var scheme: ColorScheme = .dark

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let ring: CGFloat = 30
    private let fish = 3

    var body: some View {
        let ink: Color = scheme == .light ? .black : .white
        VStack(spacing: 14) {
            TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                ZStack {
                    // Bubbles rise through the ring, one after another.
                    ForEach(0..<3, id: \.self) { i in
                        let phase = (t * 0.55 + Double(i) / 3).truncatingRemainder(dividingBy: 1)
                        Circle()
                            .strokeBorder(ink.opacity(0.55), lineWidth: 1)
                            .frame(width: 5 + CGFloat(i), height: 5 + CGFloat(i))
                            .offset(x: CGFloat(sin(t * 1.3 + Double(i) * 2)) * 4,
                                    y: 16 - CGFloat(phase) * 34)
                            .opacity(sin(phase * .pi))
                    }
                    ForEach(0..<fish, id: \.self) { i in
                        // Clockwise, with a breath of wobble so it swims
                        // rather than rotates.
                        let angle = t * 1.7 + Double(i) * (2 * .pi / Double(fish))
                        let wobble = sin(t * 6 + Double(i)) * 0.12
                        Image(systemName: "fish.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(ink.opacity(0.92 - Double(i) * 0.18))
                            .rotationEffect(.radians(angle + .pi / 2 + wobble))
                            .offset(x: CGFloat(cos(angle)) * ring, y: CGFloat(sin(angle)) * ring)
                    }
                }
                .frame(width: ring * 2 + 28, height: ring * 2 + 28)
            }
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(ink.opacity(0.85))
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.3), value: pending)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .glassPanel(shape: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String {
        guard let pending, pending > 0 else { return "filling the tank…" }
        return pending == 1 ? "one more fish on its way…" : "\(pending) fish on their way…"
    }
}

/// When a 3D tank counts as loaded.
///
/// The page mounts empty and its models arrive over 10–20 s, so "the web view
/// booted" is far too early. Loaded means: it has reported downloads, and they
/// have all settled — or it never reported any and a grace period ran out (a
/// scene with everything cached, or a page that can't be tapped).
struct TankLoadState: Equatable {
    private(set) var pending: Int?
    private(set) var sawDownloads = false
    private(set) var settled = false

    /// Longest the loader may stay up, whatever the page says.
    static let ceiling: TimeInterval = 25
    /// How long to wait for a first report before assuming there is none.
    static let quietGrace: TimeInterval = 4
    /// Decode + first paint after the last model lands.
    static let settleDelay: TimeInterval = 1.2

    mutating func report(_ count: Int) {
        pending = max(0, count)
        if count > 0 { sawDownloads = true; settled = false }
    }

    /// True once the last download has landed (call `markSettled` a beat later).
    var downloadsFinished: Bool { sawDownloads && pending == 0 }

    mutating func markSettled() { settled = true }

    func isLoading(elapsed: TimeInterval) -> Bool {
        if settled || elapsed >= Self.ceiling { return false }
        if !sawDownloads { return elapsed < Self.quietGrace }
        return true
    }

    /// Polls the state until the tank is in, reporting each change. Runs for at
    /// most `ceiling` seconds and stops when its task is cancelled.
    @MainActor
    static func watch(state: @MainActor () -> TankLoadState,
                      settle: @MainActor () -> Void,
                      onChange: @MainActor (Bool) -> Void) async {
        let started = Date()
        var last: Bool?
        while !Task.isCancelled {
            if state().downloadsFinished && !state().settled {
                try? await Task.sleep(for: .seconds(settleDelay))
                if Task.isCancelled { return }
                // Still finished after the beat? Another batch may have begun.
                if state().downloadsFinished { settle() }
            }
            let loading = state().isLoading(elapsed: Date().timeIntervalSince(started))
            if loading != last { onChange(loading); last = loading }
            if !loading { return }
            try? await Task.sleep(for: .seconds(0.35))
        }
    }
}

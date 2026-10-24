import SwiftUI

/// Liquid Glass where the OS has it, material where it doesn't. Native glass
/// samples and refracts what's behind it, which is exactly right over a live
/// scene — a flat black scrim would kill the artwork it sits on.
extension View {
    @ViewBuilder
    func glassCapsule<S: InsettableShape>(shape: S) -> some View {
        if #available(iOS 26, tvOS 26, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
        }
    }

    /// A tinted glass badge — brand color carried by the material rather than
    /// painted flat, so it belongs to the artwork under it instead of sitting
    /// on top as a sticker. Tint goes through `glassEffect`'s own API, not the
    /// app-wide `.tint()` that bleeds into every control on iOS 26.
    @ViewBuilder
    func glassBadge<S: InsettableShape>(tint: Color, shape: S) -> some View {
        if #available(iOS 26, tvOS 26, *) {
            glassEffect(.regular.tint(tint.opacity(0.55)), in: shape)
        } else {
            background(tint.opacity(0.9), in: shape)
        }
    }

    /// Non-interactive glass for surfaces that only present — cards, panels,
    /// sheets. `interactive()` costs a touch-responsive sample pass, so it is
    /// reserved for things that actually respond to a finger.
    @ViewBuilder
    func glassPanel<S: InsettableShape>(shape: S) -> some View {
        if #available(iOS 26, tvOS 26, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5))
        }
    }
}

/// How much bigger the chrome is on this window than on a phone, judged by
/// its SHORT side so a phone turned sideways (874 × 402) stays a phone. A
/// phone, or a foldable's cover screen, is 1; an iPad mini / Air 11" or an
/// unfolded foldable 1.15; a 13" iPad 1.3. Text grows with it through Dynamic Type
/// (`typeSteps`, on top of the person's own setting); fixed sizes — margins,
/// avatars, buttons, card widths — multiply by it. Without it the iPad got
/// phone-sized type and controls floating on a canvas twice as wide.
enum DeviceScale {
    static func forSize(_ size: CGSize) -> CGFloat {
        switch min(size.width, size.height) {
        case ..<600: return 1
        case ..<900: return 1.15
        default: return 1.3
        }
    }

    /// Dynamic Type steps that match a scale: 1.15 ≈ one step, 1.3 ≈ two.
    static func typeSteps(_ scale: CGFloat) -> Int {
        scale >= 1.3 ? 2 : (scale > 1 ? 1 : 0)
    }

    /// A screen-edge margin: 16 on a phone, roomier on an iPad.
    static func margin(_ scale: CGFloat) -> CGFloat {
        16 + (scale - 1) * 60
    }
}

extension EnvironmentValues {
    @Entry var deviceScale: CGFloat = 1
}

extension DynamicTypeSize {
    /// `steps` sizes larger, stopping at xxxLarge. An accessibility size is
    /// already the person's choice and is left alone.
    func stepped(_ steps: Int) -> DynamicTypeSize {
        guard steps > 0, !isAccessibilitySize,
              let here = DynamicTypeSize.allCases.firstIndex(of: self),
              let top = DynamicTypeSize.allCases.firstIndex(of: .xxxLarge) else { return self }
        return DynamicTypeSize.allCases[min(here + steps, top)]
    }
}

/// Text-heavy pages on a wide screen (iPad, a wide window): one column at a
/// readable measure, centred, instead of rows running edge to edge. The
/// measure grows with `deviceScale`, as the type does. No effect at phone
/// widths.
private struct ReadableColumn: ViewModifier {
    @Environment(\.deviceScale) private var scale
    let maxWidth: CGFloat

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: maxWidth * scale, alignment: .leading)
            .frame(maxWidth: .infinity)
    }
}

extension View {
    func readableColumn(_ maxWidth: CGFloat = 640) -> some View {
        modifier(ReadableColumn(maxWidth: maxWidth))
    }
}

/// A root page's title on a wide screen: in the reading column, not pinned to
/// the window's far edge where the system large title sits. Narrow screens
/// keep the system title untouched.
struct ColumnTitle: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let title: String

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            #if os(iOS)
            .toolbar(sizeClass == .regular ? .hidden : .automatic, for: .navigationBar)
            #endif
    }
}

/// The in-column title `ColumnTitle` pairs with. Empty at compact width.
struct ColumnTitleText: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let title: String

    var body: some View {
        if sizeClass == .regular {
            Text(title)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(Color.textPrimary)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
        }
    }
}


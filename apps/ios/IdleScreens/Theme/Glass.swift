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

extension View {
    /// Text-heavy pages on a wide screen (iPad, a wide window): one column at
    /// a readable measure, centred, instead of rows running edge to edge. No
    /// effect at phone widths.
    func readableColumn(_ maxWidth: CGFloat = 720) -> some View {
        frame(maxWidth: maxWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
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


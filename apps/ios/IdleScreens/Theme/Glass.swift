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

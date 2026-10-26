import SwiftUI

/// The `wipe` sequence transition's moving edge as a mask (compile.ts
/// `wipeMask`): opaque where the incoming segment shows, clear where the
/// outgoing still does, ramping over the feathered edge. A circle iris grows
/// from `origin` to the farthest corner; a line sweeps along `angle`. The edge
/// starts just outside the frame and ends past its far side, so k = 0 reveals
/// nothing and k = 1 everything; k = easeSmooth(elapsed / dur), as the web.
struct WipeMask: View {
    let wipe: SequenceSubset.Wipe
    let start: Date
    let duration: TimeInterval
    /// The outgoing side: everything the edge has not yet reached.
    var inverted = false

    var body: some View {
        TimelineView(.animation) { context in
            let k = SpecTimeline.easeSmooth(context.date.timeIntervalSince(start) / max(0.001, duration))
            Canvas { ctx, size in
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: Self.shading(wipe, k: k, size: size, inverted: inverted))
            }
        }
        .ignoresSafeArea()
    }

    static func shading(_ w: SequenceSubset.Wipe, k: Double, size: CGSize, inverted: Bool) -> GraphicsContext.Shading {
        let f = max(0, min(1, w.feather))
        let on = inverted ? Color.clear : Color.white, off = inverted ? Color.white : Color.clear
        let cw = size.width, ch = size.height
        if w.shape == "line" {
            let a = w.angle * .pi / 180
            let ux = cos(a), uy = sin(a)
            let proj = [0, cw * ux, ch * uy, cw * ux + ch * uy]
            let p0 = proj.min()!, span = proj.max()! - p0
            let fw = max(1, f * span)
            let lead = p0 + k * (span + fw), trail = lead - fw
            return .linearGradient(Gradient(colors: [on, off]),
                                   startPoint: CGPoint(x: ux * trail, y: uy * trail),
                                   endPoint: CGPoint(x: ux * lead, y: uy * lead))
        }
        let ox = max(0, min(1, w.originX)) * cw, oy = max(0, min(1, w.originY)) * ch
        let reach = [hypot(ox, oy), hypot(cw - ox, oy), hypot(ox, ch - oy), hypot(cw - ox, ch - oy)].max()!
        let fw = max(1, f * reach)
        let outer = max(1e-3, k * (reach + fw)), inner = max(0, outer - fw)
        return .radialGradient(Gradient(colors: [on, off]), center: CGPoint(x: ox, y: oy),
                               startRadius: inner, endRadius: max(outer, inner + 1e-3))
    }
}

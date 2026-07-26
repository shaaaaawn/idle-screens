import SwiftUI

/// Native Canvas renderer for compiled scenes. Constant-velocity drift with
/// edge wrapping; pulse opacity breathing; spin; blend honored at t3 only.
/// Feeds frame durations to the watchdog.
struct NativeSceneView: View {
    let layers: [CompiledLayer]
    let background: SpecSubset.Background?
    let tier: CapabilityTier
    var watchdog: FrameWatchdog?
    var onDowngrade: () -> Void = {}

    @State private var start = Date()
    @State private var lastTick: Date?

    var body: some View {
        TimelineView(.animation(minimumInterval: tier == .t3 ? nil : 1.0 / 30.0)) { context in
            Canvas { ctx, size in
                drawBackground(ctx: ctx, size: size)
                let t = context.date.timeIntervalSince(start)
                let minDim = min(size.width, size.height)
                // t2 load shedding: thin every layer by the same stride so the
                // composition survives (dropping whole trailing layers would cut
                // the foreground accents first).
                let total = layers.reduce(0) { $0 + $1.entities.count }
                let stride = tier == .t3 ? 1 : max(1, Int((Double(total) / 150.0).rounded(.up)))
                for layer in layers {
                    // Dimensional values (sizes, speeds, stroke widths) scale by
                    // min(w,h) for viewport specs and by 1 for px specs.
                    // Positions (x/y) are always fractions of w/h — never scaled.
                    let dim = layer.units == .px ? 1 : minDim
                    if tier == .t3 { applyBlend(ctx: &ctx, blend: layer.blend) }
                    for (i, entity) in layer.entities.enumerated() {
                        if stride > 1, i % stride != 0 { continue }
                        let point = position(of: entity, at: t, in: size, dim: dim, wrap: layer.wrap)
                        var alpha = entity.alpha
                        if let pulse = layer.pulse {
                            let wave = sin(2 * .pi * (t * 1000 / pulse.period) + entity.phase)
                            alpha = min(1, max(0, alpha * (1 + pulse.amp * wave)))
                        }
                        var grown = entity
                        // Web engine sizeAt(): margins/wrap above intentionally
                        // use the base size, like web.
                        grown.size = entity.size * SceneMotion.growScale(of: entity, at: t)
                        draw(entity: grown, sprite: layer.sprite, units: layer.units, at: point,
                             dim: dim, alpha: alpha, t: t, ctx: &ctx)
                    }
                    ctx.blendMode = .normal
                }
            }
            .onChange(of: context.date) { _, newDate in
                if let watchdog, let last = lastTick {
                    let duration = newDate.timeIntervalSince(last)
                    if duration > 0,
                       watchdog.record(duration: duration, at: newDate.timeIntervalSinceReferenceDate) {
                        onDowngrade()
                    }
                }
                lastTick = newDate
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Background

    private func drawBackground(ctx: GraphicsContext, size: CGSize) {
        let rect = CGRect(origin: .zero, size: size)
        let path = Path(rect)
        if let stops = background?.stops, !stops.isEmpty {
            let gradient = Gradient(stops: stops.map {
                Gradient.Stop(color: Color(hex: $0.color), location: CGFloat(min(1, max(0, $0.at))))
            })
            ctx.fill(path, with: .linearGradient(
                gradient,
                startPoint: CGPoint(x: rect.midX, y: rect.minY),
                endPoint: CGPoint(x: rect.midX, y: rect.maxY)
            ))
        } else if let color = background?.color {
            ctx.fill(path, with: .color(Color(hex: color)))
        } else {
            ctx.fill(path, with: .color(.black))
        }
    }

    private func applyBlend(ctx: inout GraphicsContext, blend: String?) {
        guard tier == .t3, let blend else { return }
        switch blend {
        case "lighter": ctx.blendMode = .plusLighter
        case "screen": ctx.blendMode = .screen
        case "multiply": ctx.blendMode = .multiply
        default: break
        }
    }

    // MARK: - Motion

    private func position(of entity: CompiledEntity, at t: TimeInterval,
                          in size: CGSize, dim: CGFloat, wrap: Bool) -> CGPoint {
        SceneMotion.position(of: entity, at: t, in: size, dim: dim, wrap: wrap)
    }

    // MARK: - Sprites

    private func draw(entity: CompiledEntity, sprite: SpecSubset.Sprite, units: SpecSubset.Units,
                      at point: CGPoint, dim: CGFloat, alpha: Double, t: TimeInterval,
                      ctx: inout GraphicsContext) {
        let color = Color(hex: entity.color).opacity(alpha)
        let spin = entity.spinAngle + entity.spinSpeed * t
        /// Web engine default stroke width: 2px for px specs, 0.002 for viewport.
        let defaultWidth = units == .px ? 2.0 : 0.002

        switch sprite {
        case .circle(_, _, _, let soft):
            let r = entity.size * dim
            let rect = CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)
            // Per-entity per-frame radial gradients are the renderer's most
            // expensive path — below t3, soft circles degrade to plain fills.
            if soft, tier == .t3 {
                ctx.fill(Path(ellipseIn: rect), with: .radialGradient(
                    Gradient(colors: [color, color.opacity(0)]),
                    center: point,
                    startRadius: 0,
                    endRadius: r
                ))
            } else {
                ctx.fill(Path(ellipseIn: rect), with: .color(color))
            }

        case .ring(_, _, _, let width):
            let r = entity.size * dim
            let rect = CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)
            ctx.stroke(Path(ellipseIn: rect), with: .color(color),
                       lineWidth: (width ?? defaultWidth) * dim)

        case .rect:
            let w = entity.size * dim
            let h = w * entity.aspect
            let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            layer.fill(Path(rect), with: .color(color))

        case .streak(_, _, _, let width):
            let length = entity.size * dim
            let speed = hypot(entity.vx, entity.vy)
            guard speed > 0 else { return }
            let dx = entity.vx / speed, dy = entity.vy / speed
            var path = Path()
            path.move(to: point)
            path.addLine(to: CGPoint(x: point.x - dx * length, y: point.y - dy * length))
            ctx.stroke(path, with: .color(color), lineWidth: (width ?? defaultWidth) * dim)

        case .emoji, .text:
            // Glyph sizes are raw pixels in the web engine (`${sz}px`, never
            // unit-scaled) — so no `dim` multiplier here, unlike shaped sprites.
            let text = Text(entity.glyph ?? "")
                .font(.system(size: entity.size))
                .foregroundStyle(color)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            layer.draw(text, at: .zero, anchor: .center)

        case .unknown:
            break
        }
    }
}

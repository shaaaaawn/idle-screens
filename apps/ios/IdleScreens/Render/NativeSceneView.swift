import SwiftUI

/// Native Canvas renderer for compiled scenes. Constant-velocity drift with
/// edge wrapping; pulse opacity breathing; spin; blend honored at t3 only.
/// Feeds frame durations to the watchdog.
struct NativeSceneView: View {
    let layers: [CompiledLayer]
    let background: SpecSubset.Background?
    /// 0…1 frame persistence. The web engine gets this free by compositing
    /// each frame over the last one; a SwiftUI Canvas has no accumulation
    /// buffer, so motion is smeared by re-drawing each entity at a few
    /// earlier instants with decaying alpha. Close for moving sprites (what
    /// ghosting is for) and bounded — see `ghostEchoes`.
    var ghosting: Double = 0
    let tier: CapabilityTier
    var watchdog: FrameWatchdog?
    var onDowngrade: () -> Void = {}
    /// Freeze on the current frame (backgrounded, or the guard stepped down
    /// to paused) — a view that keeps animating unseen is pure battery cost.
    var paused: Bool = false
    /// Per-frame cost callback so a host can adapt the renderer at runtime.
    var onFrame: ((TimeInterval, TimeInterval) -> Void)?
    /// Draw the scene in this coordinate space and map it into whatever size
    /// the view actually gets. Previews need 1920x1080 semantics so px-unit
    /// specs look like the fullscreen render — but laying the view out at
    /// 1920x1080pt and scaling it down costs a backing store of that size
    /// (~75 MB per tile at 3x), which is what killed the gallery on a 13 Pro.
    /// Transform the context instead: same picture, tile-sized memory.
    var referenceSize: CGSize?
    /// One frame, no animation loop — for tiles beyond the animation budget.
    var staticFrame: Bool = false

    @State private var start = Date()
    @State private var lastTick: Date?

    var body: some View {
        if staticFrame {
            Canvas { ctx, size in
                draw(into: &ctx, size: size, t: 0)
            }
            .ignoresSafeArea()
        } else {
            animated
        }
    }

    private var animated: some View {
        TimelineView(.animation(minimumInterval: tier == .t3 ? nil : 1.0 / 30.0,
                                paused: paused)) { context in
            Canvas { ctx, size in
                let t = context.date.timeIntervalSince(start)
                draw(into: &ctx, size: size, t: t)
            }
            .onChange(of: context.date) { _, newDate in
                if let last = lastTick {
                    let elapsed = newDate.timeIntervalSince(last)
                    if elapsed > 0 {
                        onFrame?(elapsed, newDate.timeIntervalSinceReferenceDate)
                    }
                }
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

    /// One frame, drawn in reference space and mapped into the real view.
    private func draw(into ctx: inout GraphicsContext, size: CGSize, t: TimeInterval) {
        // Everything below computes in `space`. When a referenceSize is set the
        // context is scaled/centred instead of the VIEW being oversized, so a
        // 148pt tile allocates a 148pt backing store while still composing the
        // scene at 1920x1080 semantics.
        let space = referenceSize ?? size
        if let referenceSize {
            let scale = max(size.width / referenceSize.width,
                            size.height / referenceSize.height)
            ctx.translateBy(x: (size.width - referenceSize.width * scale) / 2,
                            y: (size.height - referenceSize.height * scale) / 2)
            ctx.scaleBy(x: scale, y: scale)
        }

        drawBackground(ctx: ctx, size: space)
        let minDim = min(space.width, space.height)
        // t2 load shedding: thin every layer by the same stride so the
        // composition survives (dropping whole trailing layers would cut the
        // foreground accents first).
        let total = layers.reduce(0) { $0 + $1.entities.count }
        let stride = tier == .t3 ? 1 : max(1, Int((Double(total) / 150.0).rounded(.up)))
        let echoes = ghostEchoes(entityCount: total)
        for layer in layers {
            // Dimensional values (sizes, speeds, stroke widths) scale by
            // min(w,h) for viewport specs and by 1 for px specs. Positions
            // (x/y) are always fractions of w/h — never scaled.
            let dim = layer.units == .px ? 1 : minDim
            // Layer lifecycle: the whole layer fades in and out on its own
            // envelope, and is skipped outright before it enters / after it
            // leaves (web parity: compile.ts `lifeAlphaAt` gate).
            let lifeAlpha = layer.life?.alpha(at: t * 1000) ?? 1
            if lifeAlpha <= 0 { continue }
            // A parented orbit rides another layer's first entity (web
            // parity: compile.ts `parentEntityFor`), which is how a compound
            // creature keeps its parts attached.
            let parentEntity = layer.orbitParentKey.flatMap { key in
                layers.first { $0.key == key }?.entities.first
            }
            if tier == .t3 { applyBlend(ctx: &ctx, blend: layer.blend) }
            if let links = layer.links {
                drawLinks(links, layer: layer, at: t, in: space, dim: dim,
                          lifeAlpha: lifeAlpha, parent: parentEntity, ctx: &ctx)
            }
            for (i, entity) in layer.entities.enumerated() {
                if stride > 1, i % stride != 0 { continue }
                let point = SceneMotion.position(of: entity, at: t, in: space, dim: dim,
                                                 wrap: layer.wrap, parent: parentEntity)
                // One alpha model for both tiers. This used to be computed
                // inline, which quietly skipped everything SceneMotion knows
                // about — the warp fade-in and the emit window included, so
                // those worked on the sprite tier and nowhere else.
                let alpha = SceneMotion.pulsedAlpha(of: entity, layer: layer, at: t)
                // Web engine sizeAt(): margins/wrap above intentionally use the
                // base size, like web.
                // Ghost echoes first, so the live sprite paints over its trail.
                if echoes > 0 {
                    for k in (1...echoes).reversed() {
                        let back = t - Double(k) * Self.ghostStep
                        guard back >= 0 else { continue }
                        let ghostPoint = SceneMotion.position(of: entity, at: back, in: space,
                                                              dim: dim, wrap: layer.wrap,
                                                              parent: parentEntity)
                        // A wrapped sprite that jumped the edge would smear a
                        // line across the whole frame; drop those echoes.
                        if layer.wrap,
                           hypot(ghostPoint.x - point.x, ghostPoint.y - point.y)
                            > min(space.width, space.height) / 2 { continue }
                        let decay = pow(ghosting, Double(k))
                        draw(entity: entity,
                             size: entity.size * SceneMotion.growScale(of: entity, at: back),
                             sprite: layer.sprite, units: layer.units, at: ghostPoint,
                             dim: dim, alpha: alpha * lifeAlpha * decay, t: back, ctx: &ctx)
                    }
                }
                if let trail = layer.trail {
                    drawTrail(trail, entity: entity, layer: layer, at: t, head: point,
                              in: space, dim: dim, alpha: alpha * lifeAlpha,
                              parent: parentEntity, ctx: &ctx)
                }
                let grownSize = entity.size * SceneMotion.growScale(of: entity, at: t)
                draw(entity: entity, size: grownSize, sprite: layer.sprite,
                     units: layer.units, at: point,
                     dim: dim, alpha: alpha * lifeAlpha, t: t, ctx: &ctx)
            }
            ctx.blendMode = .normal
        }
    }

    /// One echo per ~30fps frame back in time.
    static let ghostStep: TimeInterval = 1.0 / 30

    /// How many echoes to afford. Heavier persistence wants a longer tail, but
    /// each echo re-draws every entity — so the budget, not the spec, has the
    /// last word, and below t3 there are none at all.
    private func ghostEchoes(entityCount: Int) -> Int {
        guard ghosting > 0.01, tier == .t3, !staticFrame else { return 0 }
        let wanted = ghosting > 0.6 ? 4 : (ghosting > 0.3 ? 3 : 2)
        let affordable = entityCount > 0 ? max(0, 1500 / entityCount - 1) : wanted
        return min(wanted, affordable)
    }

    // MARK: - Trail and links

    /// Afterglow sampled from the entity's OWN past positions — the motion is
    /// analytic, so the trail is exact rather than a recorded history.
    private func drawTrail(_ trail: SpecSubset.Trail, entity: CompiledEntity,
                           layer: CompiledLayer, at t: TimeInterval, head: CGPoint,
                           in space: CGSize, dim: CGFloat, alpha: Double,
                           parent: CompiledEntity?, ctx: inout GraphicsContext) {
        let fade = trail.fade ?? 1
        let samples = min(Int((trail.length / 50).rounded(.up)), 24)
        guard samples > 0, alpha > 0 else { return }
        let headSize = entity.size * SceneMotion.growScale(of: entity, at: t)
        let color = Color(.sRGB, red: entity.red, green: entity.green, blue: entity.blue,
                          opacity: 1)
        var prev = head
        for step in 1...samples {
            let k = Double(step) / Double(samples)
            let past = t - k * trail.length / 1000
            guard past >= 0 else { break }
            let p = SceneMotion.position(of: entity, at: past, in: space, dim: dim,
                                         wrap: layer.wrap, parent: parent)
            // A wrapped entity that jumped the seam would smear a line across
            // the frame; stop the trail at the jump instead.
            if layer.wrap,
               abs(p.x - prev.x) > space.width / 2 || abs(p.y - prev.y) > space.height / 2 {
                break
            }
            prev = p
            let a = alpha * (1 - k * fade)
            if a <= 0 { break }
            let r = headSize * dim * (1 - k * 0.7)
            if r < 0.2 { break }
            ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)),
                     with: .color(color.opacity(a)))
        }
    }

    /// Lines between nearby entities — constellations and webs. Only motions
    /// that actually wrap get toroidal neighbours; a bounce or orbit entity
    /// never crosses an edge, so a "nearest image" line would cut the screen.
    private func drawLinks(_ links: SpecSubset.Links, layer: CompiledLayer,
                           at t: TimeInterval, in space: CGSize, dim: CGFloat,
                           lifeAlpha: Double, parent: CompiledEntity?,
                           ctx: inout GraphicsContext) {
        let entities = layer.entities
        guard entities.count > 1, links.k > 0 else { return }
        // O(n²) neighbour search: bounded so a large layer cannot stall a frame.
        guard entities.count <= 220 else { return }
        let wraps = ["drift", "rise", "wander"].contains(entities[0].motionType) && layer.wrap
        let positions = entities.map {
            SceneMotion.position(of: $0, at: t, in: space, dim: dim,
                                 wrap: layer.wrap, parent: parent)
        }
        let maxDist = links.maxDist * dim
        let width = max(0.5, (links.width ?? (layer.units == .px ? 1 : 1.0 / 1080)) * dim)

        func delta(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            var dx = b.x - a.x, dy = b.y - a.y
            if wraps {
                if abs(dx) > space.width / 2 { dx += dx > 0 ? -space.width : space.width }
                if abs(dy) > space.height / 2 { dy += dy > 0 ? -space.height : space.height }
            }
            return CGPoint(x: dx, y: dy)
        }

        var seen = Set<Int64>()
        func emit(_ i: Int, _ j: Int) {
            let lo = min(i, j), hi = max(i, j)
            let key = Int64(lo) << 32 | Int64(hi)
            guard !seen.contains(key) else { return }
            let d = delta(positions[lo], positions[hi])
            let dist = hypot(d.x, d.y)
            guard dist <= maxDist else { return }
            seen.insert(key)
            var a = links.alpha ?? SceneMotion.pulsedAlpha(of: entities[lo], layer: layer, at: t)
            if links.falloff == true { a *= max(0, 1 - dist / maxDist) }
            a *= lifeAlpha
            guard a > 0.004 else { return }
            let color = links.color.map { Color(hex: $0) }
                ?? Color(.sRGB, red: entities[lo].red, green: entities[lo].green,
                         blue: entities[lo].blue, opacity: 1)
            var path = Path()
            path.move(to: positions[lo])
            path.addLine(to: CGPoint(x: positions[lo].x + d.x, y: positions[lo].y + d.y))
            ctx.stroke(path, with: .color(color.opacity(a)),
                       style: StrokeStyle(lineWidth: width, lineCap: .butt))
        }

        switch links.mode {
        case "chain":
            for i in 0..<(entities.count - 1) { emit(i, i + 1) }
            if links.closed == true, entities.count > 2 { emit(entities.count - 1, 0) }
        case "random":
            // Golden-ratio stride spreads partners instead of clustering.
            let n = entities.count
            let strideBy = max(1, Int((Double(n) * 0.381_966).rounded()))
            for i in 0..<n {
                for m in 1...links.k {
                    let j = (i + m * strideBy) % n
                    if j != i { emit(i, j) }
                }
            }
        default:  // nearest
            for i in positions.indices {
                var neighbours: [(dist: Double, j: Int)] = []
                for j in positions.indices where j != i {
                    let d = delta(positions[i], positions[j])
                    let dist = hypot(d.x, d.y)
                    if dist <= maxDist { neighbours.append((dist, j)) }
                }
                neighbours.sort { $0.dist != $1.dist ? $0.dist < $1.dist : $0.j < $1.j }
                for n in neighbours.prefix(links.k) { emit(i, n.j) }
            }
        }
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

    private func draw(entity: CompiledEntity, size: Double, sprite: SpecSubset.Sprite,
                      units: SpecSubset.Units,
                      at point: CGPoint, dim: CGFloat, alpha: Double, t: TimeInterval,
                      ctx: inout GraphicsContext) {
        // Pre-parsed components — no hex-string Scanner in the hot loop.
        let color = Color(.sRGB, red: entity.red, green: entity.green,
                          blue: entity.blue, opacity: alpha)
        let spin = entity.spinAngle + entity.spinSpeed * t
        /// Web engine default stroke width: 2px for px specs, 0.002 for viewport.
        let defaultWidth = units == .px ? 2.0 : 0.002

        switch sprite {
        case .circle(_, _, _, let soft):
            let r = size * dim
            let rect = CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)
            // Per-entity per-frame radial gradients are the renderer's most
            // expensive path — below t3, soft circles degrade to plain fills.
            if soft, tier == .t3 {
                // Web-parity falloff (compile.ts drawEntity): bright core held
                // to 35% of the radius, then fade — a plain linear fade reads
                // dimmer and mushier than the web engine's glow.
                ctx.fill(Path(ellipseIn: rect), with: .radialGradient(
                    Gradient(stops: [
                        .init(color: color, location: 0),
                        .init(color: color.opacity(0.75), location: 0.35),
                        .init(color: color.opacity(0), location: 1),
                    ]),
                    center: point,
                    startRadius: 0,
                    endRadius: r
                ))
            } else {
                ctx.fill(Path(ellipseIn: rect), with: .color(color))
            }

        case .ring(_, _, _, let width):
            let r = size * dim
            let rect = CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)
            ctx.stroke(Path(ellipseIn: rect), with: .color(color),
                       lineWidth: (width ?? defaultWidth) * dim)

        case .rect:
            let w = size * dim
            let h = w * entity.aspect
            let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            layer.fill(Path(rect), with: .color(color))

        case .streak(_, _, _, let width):
            let length = size * dim
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
                .font(.system(size: size))
                .foregroundStyle(color)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            layer.draw(text, at: .zero, anchor: .center)

        case .textBlock(let tbText, let maxWidth, let fontSize, let lineHeight,
                        let align, let tbColor, let reveal):
            drawTextBlock(text: tbText, maxWidth: maxWidth, fontSize: fontSize,
                          lineHeight: lineHeight, align: align, color: tbColor,
                          reveal: reveal, at: point, dim: dim, alpha: alpha,
                          spin: spin, t: t, ctx: &ctx)

        case .polygon(_, _, _, let sides, let points, let soft):
            let r = size * dim
            guard r >= 0.25 else { return }
            let verts = Self.polygonPoints(sides: sides, points: points, radius: r)
            guard verts.count >= 3 else { return }
            var path = Path()
            path.move(to: verts[0])
            for v in verts.dropFirst() { path.addLine(to: v) }
            path.closeSubpath()
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            if soft, tier == .t3 {
                // Same falloff as a soft circle: bright core to 35%, then out.
                layer.fill(path, with: .radialGradient(
                    Gradient(stops: [
                        .init(color: color, location: 0),
                        .init(color: color.opacity(0.75), location: 0.35),
                        .init(color: color.opacity(0), location: 1),
                    ]),
                    center: .zero, startRadius: 0, endRadius: r))
            } else {
                layer.fill(path, with: .color(color))
            }

        case .stroke(_, let pts, _, _, let width, let smooth, let taper, let orient):
            // Unit points span a −1…1 box scaled by HALF the seeded length,
            // so `length` is the mark's bounding diameter (streak's rule).
            let samples = Self.strokeSamples(points: pts, halfSize: size * dim / 2,
                                             smooth: smooth)
            guard samples.count >= 2 else { return }
            let lw = max(0.5, (width ?? defaultWidth) * dim)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            var angle = spin
            if orient, entity.vx != 0 || entity.vy != 0 {
                angle += atan2(entity.vy, entity.vx) * 180 / .pi
            }
            layer.rotate(by: .degrees(angle))
            if taper {
                // A brush mark: every sampled segment at its own width.
                for i in 1..<samples.count {
                    var seg = Path()
                    seg.move(to: samples[i - 1])
                    seg.addLine(to: samples[i])
                    let u = (Double(i) - 0.5) / Double(samples.count - 1)
                    layer.stroke(seg, with: .color(color),
                                 style: StrokeStyle(lineWidth: max(0.5, lw * Self.strokeTaper(u)),
                                                    lineCap: .round, lineJoin: .round))
                }
            } else {
                var path = Path()
                path.move(to: samples[0])
                for pt in samples.dropFirst() { path.addLine(to: pt) }
                layer.stroke(path, with: .color(color),
                             style: StrokeStyle(lineWidth: lw, lineCap: .round, lineJoin: .round))
            }

        case .bar(let values, _, _, _, _, let maxValue, let direction):
            // `values` are paint, read at draw time, so a steered value glides.
            let fraction = Self.barFraction(values: values, max: maxValue, index: entity.barIndex)
            let len = size * dim * fraction
            guard len > 0.25 else { return }
            let thick = entity.thickness > 0 ? entity.thickness * dim : size * dim * 0.2
            let box = Self.barBox(direction: direction, length: len, thickness: thick)
            var layer = ctx
            layer.translateBy(x: point.x, y: point.y)
            layer.rotate(by: .degrees(spin))
            layer.fill(Path(box), with: .color(color))

        case .unknown:
            break
        }
    }

    // MARK: - Shape geometry (port of packages/schema/src/shapes.ts)

    /// Polygon vertices about the origin. `points` (unit −1…1) wins; otherwise
    /// a regular n-gon of `sides` (default 6), point up.
    static func polygonPoints(sides: Int?, points: [[Double]]?, radius: Double) -> [CGPoint] {
        if let points, points.count >= 3 {
            return points.compactMap {
                $0.count >= 2 ? CGPoint(x: $0[0] * radius, y: $0[1] * radius) : nil
            }
        }
        let n = max(3, sides ?? 6)
        return (0..<n).map { k in
            let a = -Double.pi / 2 + 2 * .pi * Double(k) / Double(n)
            return CGPoint(x: cos(a) * radius, y: sin(a) * radius)
        }
    }

    /// The stroke path, sampled. Smooth strokes run Catmull-Rom through the
    /// control points; enough samples that every segment keeps its curve.
    static func strokeSamples(points: [[Double]], halfSize: Double, smooth: Bool) -> [CGPoint] {
        let pts = points.compactMap {
            $0.count >= 2 ? (x: $0[0] * halfSize, y: $0[1] * halfSize) : nil
        }
        let m = pts.count
        guard m >= 2 else { return pts.map { CGPoint(x: $0.x, y: $0.y) } }
        let curved = smooth && m >= 3
        let segs = m - 1
        let n = max(24, segs * 6 + 1)
        func at(_ k: Int) -> (x: Double, y: Double) { pts[max(0, min(m - 1, k))] }
        return (0..<n).map { i in
            let u = Double(i) / Double(n - 1) * Double(segs)
            let seg = min(segs - 1, Int(u.rounded(.down)))
            let local = u - Double(seg)
            let p1 = at(seg), p2 = at(seg + 1)
            guard curved else {
                return CGPoint(x: p1.x + (p2.x - p1.x) * local,
                               y: p1.y + (p2.y - p1.y) * local)
            }
            let p0 = at(seg - 1), p3 = at(seg + 2)
            return CGPoint(x: SceneMotion.catmullRom(p0.x, p1.x, p2.x, p3.x, local),
                           y: SceneMotion.catmullRom(p0.y, p1.y, p2.y, p3.y, local))
        }
    }

    /// Brush profile along a mark — thin at both ends, floored so it never
    /// vanishes mid-stroke on a coarse display.
    static func strokeTaper(_ u: Double) -> Double {
        max(0.15, sin(.pi * min(1, max(0, u))))
    }

    /// 0…1 fill of bar `index`: `values[i] / max`, max defaulting to the
    /// largest value.
    static func barFraction(values: [Double], max maxValue: Double?, index: Int) -> Double {
        guard !values.isEmpty else { return 0 }
        let v = values[((index % values.count) + values.count) % values.count]
        let top = maxValue ?? values.reduce(0) { Swift.max($0, $1) }
        guard top > 0 else { return 0 }
        return Swift.min(1, Swift.max(0, v / top))
    }

    /// Box of a bar growing from the origin toward `direction`.
    static func barBox(direction: String, length: Double, thickness: Double) -> CGRect {
        switch direction {
        case "left":  return CGRect(x: -length, y: -thickness / 2, width: length, height: thickness)
        case "up":    return CGRect(x: -thickness / 2, y: -length, width: thickness, height: length)
        case "down":  return CGRect(x: -thickness / 2, y: 0, width: thickness, height: length)
        default:      return CGRect(x: 0, y: -thickness / 2, width: length, height: thickness)
        }
    }

    // MARK: - TextBlock (t3 only — full reveal animation)

    private func drawTextBlock(
        text tbText: String, maxWidth: Double, fontSize: Double,
        lineHeight: Double, align: String, color tbColor: String,
        reveal: SpecSubset.TextRevealSpec?, at point: CGPoint,
        dim: CGFloat, alpha: Double, spin: Double, t: TimeInterval,
        ctx: inout GraphicsContext
    ) {
        let fsPx = fontSize * dim
        guard fsPx > 0.5 else { return }
        let lh = lineHeight * fsPx
        let maxWPx = maxWidth * dim
        let maxWEm = maxWPx / fsPx
        let lines = breakTextBlock(text: tbText, maxWidthEm: maxWEm)
        guard !lines.isEmpty else { return }

        let rs = reveal.map { revealState(lines: lines, reveal: $0, t: t) }
        let visibleLines = rs?.fullLines ?? lines.count

        let rgb = SpecSubset.Layer.rgb(from: tbColor)
        let fillColor = Color(.sRGB, red: rgb.0, green: rgb.1, blue: rgb.2,
                               opacity: alpha)

        var layer = ctx
        layer.translateBy(x: point.x, y: point.y)
        if spin != 0 { layer.rotate(by: .degrees(spin)) }

        let anchor: UnitPoint
        let xOff: CGFloat
        switch align {
        case "center": anchor = .top; xOff = maxWPx / 2
        case "right": anchor = .topTrailing; xOff = maxWPx
        default: anchor = .topLeading; xOff = 0
        }

        let font: Font = .system(size: fsPx)
        for li in 0..<visibleLines {
            let lineView = Text(lines[li].text).font(font).foregroundStyle(fillColor)
            layer.draw(lineView, at: CGPoint(x: xOff, y: CGFloat(li) * lh),
                       anchor: anchor)
        }

        if let rs, !rs.partialText.isEmpty {
            let partial = Text(rs.partialText).font(font).foregroundStyle(fillColor)
            layer.draw(partial, at: CGPoint(x: xOff, y: CGFloat(visibleLines) * lh),
                       anchor: anchor)
        }

        if let rs, let caretCfg = reveal?.caret {
            let hz = min(3.0, caretCfg.blink ?? 1.2)
            let on = hz <= 0 || Int(t * hz * 2) % 2 == 0
            if on {
                #if canImport(UIKit)
                let uiFont = UIFont.systemFont(ofSize: fsPx)
                let pw = (rs.caretPrefix as NSString)
                    .size(withAttributes: [.font: uiFont]).width
                #else
                let pw = textWidthEm(rs.caretPrefix) * fsPx
                #endif
                let cx: CGFloat
                switch align {
                case "center": cx = xOff + pw / 2
                case "right": cx = xOff
                default: cx = pw
                }
                let caretRGB = caretCfg.color.map { SpecSubset.Layer.rgb(from: $0) } ?? rgb
                let caretColor = Color(.sRGB, red: caretRGB.0, green: caretRGB.1,
                                        blue: caretRGB.2, opacity: alpha)
                let caretRect = CGRect(x: cx + fsPx * 0.06,
                                       y: CGFloat(rs.caretLine) * lh,
                                       width: max(1, fsPx * 0.08), height: fsPx)
                layer.fill(Path(caretRect), with: .color(caretColor))
            }
        }
    }
}

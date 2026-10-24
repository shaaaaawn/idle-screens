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
    /// Sizes the ghost-echo budget; the tier still decides the renderer.
    var renderClass: RenderClass = .standard
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
    /// Which instant a static frame shows, in seconds. Zero is the honest
    /// poster; tests render later instants to reach life envelopes, emitters
    /// and trails without an animation loop.
    var staticTime: TimeInterval = 0
    /// Paint no ground: the view composites over whatever is beneath it —
    /// a sequence segment over its bed.
    var transparentGround: Bool = false

    @State private var start = Date()
    @State private var lastTick: Date?

    var body: some View {
        if staticFrame {
            Canvas { ctx, size in
                draw(into: &ctx, size: size, t: staticTime)
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
        RenderProbe.hit(staticFrame ? "scene.static" : "scene.live")
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

        if !transparentGround { drawBackground(ctx: ctx, size: space, t: t) }
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
            // Paint opacity (the layer's own × its group's) multiplies the
            // envelope, and 0 skips the layer, as on the web.
            let lifeAlpha = (layer.life?.alpha(at: t * 1000) ?? 1) * layer.opacity
            if lifeAlpha <= 0 { continue }
            // A paint transform draws the whole layer through G·L on a copy
            // of the context, so nothing below needs to know about it.
            var layerCtx = ctx
            if let paint = layer.paint {
                layerCtx.concatenate(paint.affine(in: space, unit: dim))
            }
            // A parented orbit rides another layer's first entity (web
            // parity: compile.ts `parentEntityFor`), which is how a compound
            // creature keeps its parts attached.
            let parentEntity = layer.orbitParentKey.flatMap { key in
                layers.first { $0.key == key }?.entities.first
            }
            if tier == .t3 { applyBlend(ctx: &layerCtx, blend: layer.blend) }
            if let links = layer.links {
                drawLinks(links, layer: layer, at: t, in: space, dim: dim,
                          lifeAlpha: lifeAlpha, parent: parentEntity, ctx: &layerCtx)
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
                             sprite: layer.sprite, textStyle: layer.textStyle, feather: layer.feather, units: layer.units, space: space, at: ghostPoint,
                             dim: dim, alpha: alpha * lifeAlpha * decay, t: back, ctx: &layerCtx)
                    }
                }
                if let trail = layer.trail {
                    drawTrail(trail, entity: entity, layer: layer, at: t, head: point,
                              in: space, dim: dim, alpha: alpha * lifeAlpha,
                              parent: parentEntity, ctx: &layerCtx)
                }
                let grownSize = entity.size * SceneMotion.growScale(of: entity, at: t)
                draw(entity: entity, size: grownSize, sprite: layer.sprite, textStyle: layer.textStyle, feather: layer.feather,
                     units: layer.units, space: space, at: point,
                     dim: dim, alpha: alpha * lifeAlpha, t: t, ctx: &layerCtx)
            }
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
        let budget = renderClass.ghostDrawBudget
        let affordable = entityCount > 0 ? max(0, budget / entityCount - 1) : wanted
        return min(wanted, affordable)
    }

    // MARK: - Trail and links

    /// Afterglow sampled from the entity's OWN past positions — the motion is
    /// analytic, so the trail is exact rather than a recorded history.
    private func drawTrail(_ trail: SpecSubset.Trail, entity: CompiledEntity,
                           layer: CompiledLayer, at t: TimeInterval, head: CGPoint,
                           in space: CGSize, dim: CGFloat, alpha: Double,
                           parent: CompiledEntity?, ctx: inout GraphicsContext) {
        guard alpha > 0 else { return }
        let headSize = entity.size * SceneMotion.growScale(of: entity, at: t)
        let shaped: Bool, hardCircle: Bool, soft: Bool
        switch layer.sprite {
        case .circle(_, _, _, let isSoft): shaped = false; hardCircle = !isSoft; soft = isSoft
        case .ring, .rect, .streak, .polygon, .stroke, .bar: shaped = true; hardCircle = false; soft = false
        default: shaped = false; hardCircle = false; soft = false
        }
        // Only soft discs and glyph trails are gap-filled (web X469): a hard
        // circle's echoes join into a ribbon, a shape's stay at its samples.
        let fill = shaped || hardCircle ? 0 : Self.trailFillBudget(layer.entities.count)
        let echoes = Self.trailEchoes(trail, at: t, headAlpha: alpha, headRadius: headSize * dim,
                                      posAt: { SceneMotion.position(of: entity, at: $0, in: space, dim: dim,
                                                                     wrap: layer.wrap, parent: parent) },
                                      in: space, wrap: layer.wrap, fillBudget: fill,
                                      additive: layer.blend == "lighter")
        guard !echoes.isEmpty else { return }
        // A shaped sprite trails echoes of its own shape, at the echo's own
        // time — a spinning or heading-turned mark echoes the way it was then.
        if shaped {
            for ec in echoes {
                draw(entity: entity, size: headSize * ec.r / max(0.0001, headSize * dim),
                     sprite: layer.sprite, textStyle: layer.textStyle, feather: layer.feather, units: layer.units,
                     space: space, at: ec.point, dim: dim, alpha: ec.alpha, t: ec.t, ctx: &ctx)
            }
            return
        }
        let color = Color(.sRGB, red: entity.red, green: entity.green, blue: entity.blue, opacity: 1)
        if hardCircle {
            fillRibbon(head: head, headRadius: headSize * dim, headAlpha: alpha, echoes: echoes,
                       posAt: { SceneMotion.position(of: entity, at: $0, in: space, dim: dim,
                                                      wrap: layer.wrap, parent: parent) },
                       t: t, color: color, ctx: &ctx)
            return
        }
        for ec in echoes {
            let rect = CGRect(x: ec.point.x - ec.r, y: ec.point.y - ec.r, width: ec.r * 2, height: ec.r * 2)
            if soft {
                ctx.fill(Path(ellipseIn: rect), with: .radialGradient(
                    Gradient(stops: [.init(color: color.opacity(ec.alpha), location: 0),
                                     .init(color: color.opacity(ec.alpha * 0.75), location: 0.35),
                                     .init(color: color.opacity(0), location: 1)]),
                    center: ec.point, startRadius: 0, endRadius: ec.r))
            } else {
                ctx.fill(Path(ellipseIn: rect), with: .color(color.opacity(ec.alpha)))
            }
        }
    }

    /// A hard circle's trail as ONE ribbon tapering through its echoes (web
    /// X469): quads between shared cross-sections, so nothing overlaps (no
    /// beads under a blend) and a fast mover draws a line rather than dots.
    /// Spans whose alphas sit within 4 % of the head's merge into one fill;
    /// each span is subdivided (≤ ~12 px chords, ≤ 8 per span) so a curve
    /// stays a curve.
    private func fillRibbon(head: CGPoint, headRadius: Double, headAlpha: Double,
                            echoes: [TrailEcho], posAt: (TimeInterval) -> CGPoint,
                            t: TimeInterval, color: Color, ctx: inout GraphicsContext) {
        var pts = [head], radii = [headRadius], alphas = [headAlpha]
        var prevT = t
        for ec in echoes {
            let p0 = pts[pts.count - 1], r0 = radii[radii.count - 1], a0 = alphas[alphas.count - 1]
            let sub = max(1, min(8, Int((hypot(ec.point.x - p0.x, ec.point.y - p0.y) / 12).rounded(.up))))
            if sub > 1 {
                for j in 1..<sub {
                    let f = Double(j) / Double(sub)
                    pts.append(posAt(prevT + (ec.t - prevT) * f))
                    radii.append(r0 + (ec.r - r0) * f)
                    alphas.append(a0 + (ec.alpha - a0) * f)
                }
            }
            pts.append(ec.point); radii.append(ec.r); alphas.append(ec.alpha)
            prevT = ec.t
        }
        let sides = Self.ribbonSides(pts, half: radii)
        guard sides.left.count == pts.count else { return }
        let tol = max(0.004, headAlpha * 0.04)
        var from = 0
        while from < pts.count - 1 {
            let a0 = alphas[from + 1]
            var to = from + 1
            var sum = a0
            while to < pts.count - 1, abs(alphas[to + 1] - a0) <= tol { sum += alphas[to + 1]; to += 1 }
            var path = Path()
            path.move(to: sides.left[from])
            for i in (from + 1)...to { path.addLine(to: sides.left[i]) }
            for i in stride(from: to, through: from, by: -1) { path.addLine(to: sides.right[i]) }
            path.closeSubpath()
            ctx.fill(path, with: .color(color.opacity(sum / Double(to - from))))
            from = to
        }
    }

    struct TrailEcho {
        var t: TimeInterval
        var point: CGPoint
        /// 0 (head) … 1 (tail).
        var k: Double
        var alpha: Double
        /// Radius in view points.
        var r: Double
    }

    /// Most gap-filling echoes one entity may add (web trail.ts `trailFillBudget`).
    static func trailFillBudget(_ layerCount: Int) -> Int {
        max(4, min(48, 240 / max(1, layerCount)))
    }

    /// The echoes behind an entity at `t` (seconds), head first — a port of
    /// trail.ts `trailEchoes`: `length/50` samples (≤ 24), each fainter
    /// (`fade`) and smaller (to 30 % at the tail), stopping at a wrap seam,
    /// the clock's start or invisibility; spans wider than an echo's radius
    /// gap-filled within `fillBudget`, each fill echo carrying its share of
    /// the ink of the echo it replaces.
    static func trailEchoes(_ trail: SpecSubset.Trail, at t: TimeInterval, headAlpha: Double,
                            headRadius: Double, posAt: (TimeInterval) -> CGPoint, in space: CGSize,
                            wrap: Bool, fillBudget: Int, additive: Bool) -> [TrailEcho] {
        let fade = trail.fade ?? 1
        let n = min(Int((trail.length / 50).rounded(.up)), 24)
        guard n > 0 else { return [] }
        func alphaAt(_ k: Double) -> Double { headAlpha * (1 - k * fade) }
        func radiusAt(_ k: Double) -> Double { headRadius * (1 - k * 0.7) }
        func jumps(_ a: CGPoint, _ b: CGPoint) -> Bool {
            wrap && (abs(b.x - a.x) > space.width / 2 || abs(b.y - a.y) > space.height / 2)
        }
        let head = posAt(t)
        var base: [TrailEcho] = []
        var prev = head
        for s in 1...n {
            let k = Double(s) / Double(n)
            let past = t - k * trail.length / 1000
            if past < 0 { break }
            let p = posAt(past)
            if jumps(prev, p) { break }
            prev = p
            let a = alphaAt(k)
            if a <= 0 { break }
            let r = radiusAt(k)
            if r < 0.2 { break }
            base.append(TrailEcho(t: past, point: p, k: k, alpha: a, r: r))
        }
        guard !base.isEmpty, fillBudget > 0 else { return base }
        var need: [Int] = []
        var total = 0
        for i in base.indices {
            let a = i == 0 ? head : base[i - 1].point
            let d = hypot(base[i].point.x - a.x, base[i].point.y - a.y)
            // ε: a span that is a whole number of radii must not gain an echo
            // from float noise (this clock is seconds, the web's is ms).
            let m = d > base[i].r ? Int((d / base[i].r - 1e-9).rounded(.up)) - 1 : 0
            need.append(m); total += m
        }
        guard total > 0 else { return base }
        let scale = total > fillBudget ? Double(fillBudget) / Double(total) : 1
        var out: [TrailEcho] = []
        var last = head
        for i in base.indices {
            let b = base[i]
            let m = Int((Double(need[i]) * scale).rounded(.down))
            if m == 0 { out.append(b); last = b.point; continue }
            let a = i == 0 ? head : base[i - 1].point
            let spacing = hypot(b.point.x - a.x, b.point.y - a.y) / Double(m + 1)
            func share(_ alpha: Double, _ r: Double) -> Double {
                let k = min(1, spacing / (2 * r))
                return additive ? alpha * k : 1 - pow(1 - min(1, alpha), k)
            }
            let t0 = i == 0 ? t : base[i - 1].t
            let k0 = i == 0 ? 0 : base[i - 1].k
            for j in 1...m {
                let f = Double(j) / Double(m + 1)
                let tt = t0 + (b.t - t0) * f
                let k = k0 + (b.k - k0) * f
                let p = posAt(tt)
                if jumps(last, p) { continue }
                last = p
                let r = radiusAt(k)
                out.append(TrailEcho(t: tt, point: p, k: k, alpha: share(alphaAt(k), r), r: r))
            }
            var bb = b
            bb.alpha = share(b.alpha, b.r)
            out.append(bb)
            last = b.point
        }
        return out
    }

    /// Lines between nearby entities — constellations and webs. Only motions
    /// that actually wrap get toroidal neighbours; a bounce or orbit entity
    /// never crosses an edge, so a "nearest image" line would cut the screen.
    private func drawLinks(_ links: SpecSubset.Links, layer: CompiledLayer,
                           at t: TimeInterval, in space: CGSize, dim: CGFloat,
                           lifeAlpha: Double, parent: CompiledEntity?,
                           ctx: inout GraphicsContext) {
        let entities = layer.entities
        guard entities.count > 1 else { return }
        let chain = links.mode == "chain"
        let k = links.k ?? 1
        guard chain || k > 0 else { return }
        // O(n²) neighbour search: bounded so a large layer cannot stall a frame.
        guard entities.count <= 220 else { return }
        let wraps = ["drift", "rise", "wander"].contains(entities[0].motionType) && layer.wrap
        let positions = entities.map {
            SceneMotion.position(of: $0, at: t, in: space, dim: dim,
                                 wrap: layer.wrap, parent: parent)
        }
        // An absent maxDist is no cutoff; a chain ignores it as a cutoff either
        // way (simulate.ts linkEdges) and reads it only as the falloff distance.
        let maxDist: CGFloat = links.maxDist.map { CGFloat($0) * dim } ?? .infinity
        let cutoff: CGFloat = chain ? .infinity : maxDist
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
            guard dist <= cutoff else { return }
            seen.insert(key)
            var a = links.alpha ?? SceneMotion.pulsedAlpha(of: entities[lo], layer: layer, at: t)
            if links.falloff == true, maxDist.isFinite { a *= max(0, 1 - dist / maxDist) }
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
                for m in 1...k {
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
                for n in neighbours.prefix(k) { emit(i, n.j) }
            }
        }
    }

    // MARK: - Background

    private func drawBackground(ctx: GraphicsContext, size: CGSize, t: TimeInterval) {
        let rect = CGRect(origin: .zero, size: size)
        let path = Path(rect)
        if let background, let raw = background.stops, !raw.isEmpty {
            // Drift can carry one stop past its neighbour; a canvas gradient
            // sorts by offset, so do the same (stably) before handing over.
            let stops = background.driftedStops(at: t * 1000)
                .enumerated()
                .sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at
                                                         : $0.offset < $1.offset }
                .map(\.element)
            let gradient = Gradient(stops: stops.map {
                Gradient.Stop(color: Color(hex: $0.color), location: CGFloat(min(1, max(0, $0.at))))
            })
            ctx.fill(path, with: .linearGradient(
                gradient,
                startPoint: CGPoint(x: rect.midX, y: rect.minY),
                endPoint: CGPoint(x: rect.midX, y: rect.maxY)
            ))
        } else if let color = background?.primaryColor {
            ctx.fill(path, with: .color(Color(hex: color)))
        } else {
            // The web engine's own default, not pure black.
            ctx.fill(path, with: .color(Color(hex: "05050a")))
        }
        if let band = background?.band, band.height > 0 {
            // Band height is dimensional, so it follows the spec's units —
            // which every compiled layer carries.
            let px = layers.first?.units == .px
            let h = band.height * (px ? 1 : min(size.width, size.height))
            ctx.fill(Path(CGRect(x: 0, y: size.height - h, width: size.width, height: h)),
                     with: .color(Color(hex: band.color)))
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
                      textStyle: SpecSubset.TextStyle? = nil, feather: Double = 0,
                      units: SpecSubset.Units, space: CGSize = .zero,
                      at point: CGPoint, dim: CGFloat, alpha: Double, t: TimeInterval,
                      ctx: inout GraphicsContext) {
        // Pre-parsed components — no hex-string Scanner in the hot loop.
        let color = Color(.sRGB, red: entity.red, green: entity.green,
                          blue: entity.blue, opacity: alpha)
        // Shared with the sprite tier — static `rotate` included.
        let spin = SceneMotion.rotationDegrees(of: entity, at: t)
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
            if feather > 0 {
                // Soft edges (web X383): a separable linear ramp,
                // ramp(u) × ramp(v) — one gradient across, masked by one down.
                let stops = Self.featherStops(feather)
                layer.drawLayer { l in
                    l.fill(Path(rect), with: .linearGradient(
                        Gradient(stops: stops.map { .init(color: color.opacity($0.alpha), location: $0.at) }),
                        startPoint: CGPoint(x: -w / 2, y: 0), endPoint: CGPoint(x: w / 2, y: 0)))
                    l.blendMode = .destinationIn
                    l.fill(Path(rect), with: .linearGradient(
                        Gradient(stops: stops.map { .init(color: .white.opacity($0.alpha), location: $0.at) }),
                        startPoint: CGPoint(x: 0, y: -h / 2), endPoint: CGPoint(x: 0, y: h / 2)))
                }
            } else {
                layer.fill(Path(rect), with: .color(color))
            }

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
            drawTextBlock(style: textStyle, text: tbText, maxWidth: maxWidth, fontSize: fontSize,
                          lineHeight: lineHeight, align: align, color: tbColor,
                          reveal: reveal, at: point, dim: dim, alpha: alpha,
                          spin: spin, t: t, ctx: &ctx)

        case .polygon(_, _, _, let sides, let points, let soft, let drawing):
            let r = size * dim
            guard r >= 0.25 else { return }
            if let drawing {
                // A path drawing: rasterised once per (drawing, colour, size step)
                // and placed — the Canvas would otherwise refill every path, every
                // frame. The raster is drawn at r / its snapped radius.
                let w = space.width > 0 ? space.width : dim, h = space.height > 0 ? space.height : dim
                guard let ras = PathRaster.raster(drawing, color: entity.color, r: r, width: w, height: h,
                                                  scale: Self.rasterScale) else { return }
                let uniform = drawing.span == "box"
                let k = uniform ? r / pow(2, ceil(log2(max(r, 0.5)) * 8) / 8) : 1
                var layer = ctx
                layer.translateBy(x: point.x, y: point.y)
                layer.rotate(by: .degrees(spin))
                layer.opacity = alpha
                let pt = 1 / ras.scale * k
                layer.draw(Image(decorative: ras.image, scale: 1),
                           in: CGRect(x: -ras.anchor.x * pt, y: -ras.anchor.y * pt,
                                      width: CGFloat(ras.image.width) * pt, height: CGFloat(ras.image.height) * pt))
                return
            }
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
                // A brush mark: its tapered outline, filled ONCE (web X386).
                // Stroking each segment at its own width overlapped at every
                // joint, and a translucent mark showed each overlap as a bead.
                layer.fill(Self.polygonPath(Self.strokeOutline(samples, lineWidth: lw)), with: .color(color))
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

    /// Path-drawing raster density, px per point (Apple TV renders at 1×–2×).
    static let rasterScale: CGFloat = 2

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
    /// Linear strokes include every vertex (shapes.ts `strokeSamples`).
    static func strokeSamples(points: [[Double]], halfSize: Double, smooth: Bool) -> [CGPoint] {
        let pts = points.compactMap {
            $0.count >= 2 ? (x: $0[0] * halfSize, y: $0[1] * halfSize) : nil
        }
        let m = pts.count
        guard m >= 2 else { return pts.map { CGPoint(x: $0.x, y: $0.y) } }
        let curved = smooth && m >= 3
        let segs = m - 1
        var n = max(24, segs * 6 + 1)
        // A polyline samples a whole number of steps per segment, so every
        // authored vertex is a sample and its corners stay sharp (X566).
        if !curved { n = (n - 1 + segs - 1) / segs * segs + 1 }
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

    /// Gradient stops of shapes.ts `featherRamp` across one axis: 0 at each
    /// edge, 1 from `feather/2` of the width in; a wide feather peaks below 1.
    static func featherStops(_ feather: Double) -> [(at: Double, alpha: Double)] {
        let band = min(1, max(0, feather)) / 2
        guard band > 0 else { return [(0, 1), (1, 1)] }
        if band >= 0.5 { return [(0, 0), (0.5, min(1, 0.5 / band)), (1, 0)] }
        return [(0, 0), (band, 1), (1 - band, 1), (1, 0)]
    }

    /// A closed path through `pts`.
    static func polygonPath(_ pts: [CGPoint]) -> Path {
        var path = Path()
        guard let first = pts.first else { return path }
        path.move(to: first)
        for p in pts.dropFirst() { path.addLine(to: p) }
        path.closeSubpath()
        return path
    }

    /// The two sides of a ribbon through `pts`, `half[i]` either side of
    /// point i along its joint's bisector normal — mitred, the miter capped
    /// at 2×. `left` is the +normal side (−ty, tx). Port of shapes.ts
    /// `ribbonSides`.
    static func ribbonSides(_ pts: [CGPoint], half: [Double]) -> (left: [CGPoint], right: [CGPoint]) {
        let n = pts.count
        guard n >= 2 else { return ([], []) }
        func dir(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            let dx = b.x - a.x, dy = b.y - a.y
            let l = hypot(dx, dy)
            return l > 1e-9 ? CGPoint(x: dx / l, y: dy / l) : CGPoint(x: 1, y: 0)
        }
        var left: [CGPoint] = [], right: [CGPoint] = []
        left.reserveCapacity(n); right.reserveCapacity(n)
        for i in 0..<n {
            let tIn = i > 0 ? dir(pts[i - 1], pts[i]) : dir(pts[0], pts[1])
            let tOut = i < n - 1 ? dir(pts[i], pts[i + 1]) : tIn
            var tx = tIn.x + tOut.x, ty = tIn.y + tOut.y
            let tl = hypot(tx, ty)
            if tl < 1e-9 { tx = tOut.x; ty = tOut.y } else { tx /= tl; ty /= tl }
            let hw = half[i] / max(0.5, tx * tOut.x + ty * tOut.y)
            left.append(CGPoint(x: pts[i].x - ty * hw, y: pts[i].y + tx * hw))
            right.append(CGPoint(x: pts[i].x + ty * hw, y: pts[i].y - tx * hw))
        }
        return (left, right)
    }

    /// A tapered stroke's filled outline: the samples offset ±half their
    /// tapered width (`lw × strokeTaper(i/(n−1))`, floored at 0.5 px), with
    /// round end caps, as one closed polygon. Port of shapes.ts `strokeOutline`.
    static func strokeOutline(_ pts: [CGPoint], lineWidth lw: Double, taper: Bool = true) -> [CGPoint] {
        let n = pts.count
        guard n >= 2 else { return [] }
        func half(_ i: Int) -> Double { max(0.5, taper ? lw * strokeTaper(Double(i) / Double(n - 1)) : lw) / 2 }
        func dir(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
            let dx = b.x - a.x, dy = b.y - a.y
            let l = hypot(dx, dy)
            return l > 1e-9 ? CGPoint(x: dx / l, y: dy / l) : CGPoint(x: 1, y: 0)
        }
        let sides = ribbonSides(pts, half: (0..<n).map(half))
        func cap(_ c: CGPoint, _ r: Double, from: Double) -> [CGPoint] {
            (1..<6).map { k in
                let a = from - .pi * Double(k) / 6
                return CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r)
            }
        }
        let endT = dir(pts[n - 2], pts[n - 1]), startT = dir(pts[0], pts[1])
        let endA = atan2(endT.y, endT.x) + .pi / 2
        let startA = atan2(startT.y, startT.x) - .pi / 2
        return sides.left + cap(pts[n - 1], half(n - 1), from: endA)
            + sides.right.reversed() + cap(pts[0], half(0), from: startA)
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
        style: SpecSubset.TextStyle? = nil,
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
        // Paint-level opacity for the block only (layer alpha is per entity).
        let fillColor = Color(.sRGB, red: rgb.0, green: rgb.1, blue: rgb.2,
                               opacity: alpha * min(1, max(0, style?.opacity ?? 1)))

        var layer = ctx
        layer.translateBy(x: point.x, y: point.y)
        if spin != 0 { layer.rotate(by: .degrees(spin)) }
        if let style, style.anchor != nil {
            // `position` names a point of the rendered INK, not the layout
            // box's top-left; rotation stays about that point.
            let widest = (lines.map(\.widthEm).max() ?? 0) * fsPx
            let off = style.anchorOffset(align: align, maxWidthPx: maxWPx,
                                         widestLinePx: widest,
                                         totalHeightPx: Double(lines.count) * lh)
            layer.translateBy(x: off.dx, y: off.dy)
        }

        let anchor: UnitPoint
        let xOff: CGFloat
        switch align {
        case "center": anchor = .top; xOff = maxWPx / 2
        case "right": anchor = .topTrailing; xOff = maxWPx
        default: anchor = .topLeading; xOff = 0
        }

        // A CSS font shorthand can only be honoured in kind on a system
        // font: weight, slant, and serif / mono / rounded.
        let traits = style?.fontTraits ?? (bold: false, italic: false, design: "default")
        let design: Font.Design = traits.design == "mono" ? .monospaced
            : traits.design == "serif" ? .serif
            : traits.design == "rounded" ? .rounded : .default
        var font: Font = .system(size: fsPx, weight: traits.bold ? .bold : .regular, design: design)
        if traits.italic { font = font.italic() }
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

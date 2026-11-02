import SwiftUI
import RealityKit
import UIKit

/// Spike: the metaquarium tank in 3D through RealityKit (tvOS 26+), behind
/// the `-tank3d` launch argument. The 2D lofi tank stays the default.
///
/// What it ports: the cast (`fishMix`, bundled rig breeds only), each fish's
/// seeded swim route (SwimPlan, pinned to plan.ts by goldens), the `loop`
/// style's closed-form distance, the tail beat (clip time = distance × 0.045,
/// tank.ts), the default `orbit` shot, fog colour as the ground. Not yet:
/// fog falloff, environments, swim styles, maneuvers, per-breed rigs, look
/// params.
@available(tvOS 26.0, *)
struct Tank3DView: View {
    var seed: UInt32 = 42
    var fishMix: String = "angelfish:3,betafish:3,blowfish:2,glowfish:2,shark:1,babyfish:2"
    var azimuth: Double = 35
    var elevation: Double = 15
    var distance: Double = 110
    var debugAxis = false

    var body: some View {
        RealityView { content in
            content.camera = .virtual
            FishSystem.registerSystem()
            FishComponent.registerComponent()

            let root = Entity()
            content.add(root)

            let az = azimuth * .pi / 180, el = elevation * .pi / 180
            let eye = SIMD3<Float>(Float(cos(el) * sin(az) * distance),
                                   Float(max(10, 15 + sin(el) * distance)),
                                   Float(cos(el) * cos(az) * distance))
            let target = SIMD3<Float>(0, 35, 0)
            let fog = TankFog(eye: eye, forward: simd_normalize(target - eye))
            FishSystem.fog = fog

            // Ground: tank.ts's floor disc (radius 600, #0a1d33, unlit), with
            // the fog baked in from this camera — three fogs it per pixel.
            if let floor = fog.floor(radius: 600, color: SIMD3(0x0a, 0x1d, 0x33)) { root.addChild(floor) }

            let key = DirectionalLight()
            key.light.intensity = 2600
            key.look(at: .zero, from: SIMD3(60, 160, 90), relativeTo: nil)
            root.addChild(key)
            let fill = DirectionalLight()
            fill.light.intensity = 900
            fill.look(at: .zero, from: SIMD3(-120, 40, -60), relativeTo: nil)
            root.addChild(fill)

            var templates: [String: Entity] = [:]
            let breeds = Self.cast(fishMix)
            for (index, breed) in breeds.enumerated() {
                if templates[breed] == nil {
                    guard let url = Bundle.main.url(forResource: breed, withExtension: "usdz"),
                          let loaded = try? await Entity(contentsOf: url) else {
                        print("TANK3D missing \(breed).usdz"); continue
                    }
                    templates[breed] = loaded
                    let b = loaded.visualBounds(relativeTo: nil)
                    print("TANK3D \(breed) extents=\(b.extents) center=\(b.center)")
                }
                guard let template = templates[breed] else { continue }
                let fish = template.clone(recursive: true)
                // Normalise to the breed's nominal length (swim.ts FISH_LENGTH × BREED_SIZE).
                let bounds = fish.visualBounds(relativeTo: nil)
                let extent = max(bounds.extents.x, bounds.extents.y, bounds.extents.z)
                let length = Float(18 * Self.breedSize[breed, default: 1])
                let body = Entity()
                body.addChild(fish)
                fish.scale = SIMD3(repeating: length / max(extent, 0.0001))
                fish.position = -bounds.center * fish.scale
                var controller: AnimationPlaybackController?
                if let clip = fish.availableAnimations.first {
                    controller = fish.playAnimation(clip.repeat())
                    controller?.pause()
                }
                let plan = SwimPlan(rng: TankRng(seed: seed).fork(0x715).fork(index), shape: .wander,
                                    cameraAzimuthDeg: azimuth)
                // Spread along the route (swim.ts fishVariation anchor) — the
                // styles a mixed cast swims all hold station along their loop.
                let anchor = Self.fishHash(index, 7) * plan.totalLength
                body.components.set(FishComponent(plan: plan, anchor: anchor, clip: controller,
                                                  clipDuration: fish.availableAnimations.first?.definition.duration ?? 0))
                root.addChild(body)
            }
            print("TANK3D cast=\(breeds.count) breeds=\(templates.keys.sorted())")

            let camera = PerspectiveCamera()
            camera.camera.fieldOfViewInDegrees = 55
            camera.camera.near = 1
            camera.camera.far = 2000
            camera.look(at: target, from: eye, relativeTo: nil)
            root.addChild(camera)
        }
        .background(Color(red: 3 / 255, green: 0, blue: 9 / 255))
        .ignoresSafeArea()
    }

    /// swim.ts BREED_SIZE.
    static let breedSize: [String: Double] = [
        "betafish": 1, "angelfish": 1, "seahorse": 0.8, "seaturtle": 1.35, "shark": 2.2, "dori": 0.9,
        "glowfish": 0.8, "babyfish": 0.45, "hackerfish": 0.85, "blowfish": 0.8, "dolphin": 1.8,
    ]

    /// swim.ts `fishHash`: a deterministic 0..1 per (index, salt).
    static func fishHash(_ index: Int, _ salt: Double) -> Double {
        let x = sin(Double(index + 1) * 127.1 + salt * 311.7) * 43758.5453
        return x - x.rounded(.down)
    }

    /// One breed name per fish, in cast order (FishMix expands minted aliases).
    static func cast(_ mix: String) -> [String] {
        FishMix.parse(mix).flatMap { Array(repeating: $0.breed, count: max(1, $0.count)) }
    }
}

/// One swimmer: its route and its tail-beat clip.
@available(tvOS 26.0, *)
struct FishComponent: Component {
    var plan: SwimPlan
    var anchor: Double
    var clip: AnimationPlaybackController?
    var clipDuration: TimeInterval
}

/// Poses every fish from the scene clock: position and heading from the
/// plan (a pure function of t), bank into turns, tail beat from distance.
/// Logs the frame rate every five seconds.
@available(tvOS 26.0, *)
struct FishSystem: System {
    static let query = EntityQuery(where: .has(FishComponent.self))
    /// The camera's fog, set when the tank mounts.
    nonisolated(unsafe) static var fog: TankFog?
    private var t: Double = 0
    private var frames = 0
    private var window: Double = 0

    init(scene: RealityKit.Scene) {}

    mutating func update(context: SceneUpdateContext) {
        let dt = context.deltaTime
        t += dt
        frames += 1
        window += dt
        if window >= 5 {
            print(String(format: "TANK3D fps=%.1f", Double(frames) / window))
            frames = 0; window = 0
        }
        for entity in context.entities(matching: Self.query, updatingSystemWhen: .rendering) {
            guard let fish = entity.components[FishComponent.self] else { continue }
            let pose = fish.plan.pose(atDistance: fish.anchor + fish.plan.distance(at: t))
            entity.position = SIMD3(Float(pose.x), Float(pose.y), Float(pose.z))
            entity.orientation = Self.heading(pose)
            if let fog = Self.fog {
                entity.components.set(OpacityComponent(opacity: 1 - fog.factor(at: entity.position)))
            }
            if let clip = fish.clip, fish.clipDuration > 0 {
                clip.time = (pose.dist * 0.045).truncatingRemainder(dividingBy: fish.clipDuration)
            }
        }
    }

    /// three.js `lookAt` on an object turns its +Z toward the forward tangent,
    /// then `rotateZ(roll)` banks it.
    static func heading(_ p: SwimPlan.Pose) -> simd_quatf {
        let z = simd_normalize(SIMD3<Float>(Float(p.fx), Float(p.fy), Float(p.fz)))
        var x = simd_cross(SIMD3<Float>(0, 1, 0), z)
        if simd_length(x) < 1e-5 { x = SIMD3(1, 0, 0) }
        x = simd_normalize(x)
        let y = simd_cross(z, x)
        let look = simd_quatf(simd_float3x3(columns: (x, y, z)))
        return look * simd_quatf(angle: Float(p.roll), axis: SIMD3(0, 0, 1))
    }
}

import SwiftUI
import RealityKit

/// Spike: the metaquarium tank in 3D through RealityKit (tvOS 26+), behind
/// the `-tank3d` launch argument. The 2D lofi tank stays the default.
@available(tvOS 26.0, *)
struct Tank3DView: View {
    var body: some View {
        RealityView { content in
            content.camera = .virtual
            if let url = Bundle.main.url(forResource: "angelfish", withExtension: "usdz"),
               let fish = try? await Entity(contentsOf: url) {
                let bounds = fish.visualBounds(relativeTo: nil)
                let extent = max(bounds.extents.x, bounds.extents.y, bounds.extents.z)
                fish.scale = SIMD3(repeating: 0.6 / max(extent, 0.0001))
                fish.position = -bounds.center * fish.scale
                print("TANK3D anims=\(fish.availableAnimations.count) extent=\(extent) skinned=\(Self.hasSkeleton(fish))")
                for a in fish.availableAnimations { print("TANK3D anim name=\(a.name ?? "-") dur=\(a.definition.duration)") }
                if let swim = fish.availableAnimations.max(by: { $0.definition.duration < $1.definition.duration }) {
                    fish.playAnimation(swim.repeat())
                }
                content.add(fish)
            } else {
                print("TANK3D failed to load angelfish.usdz")
            }
            let light = DirectionalLight()
            light.light.intensity = 3000
            light.look(at: .zero, from: SIMD3(1, 2, 2), relativeTo: nil)
            content.add(light)

            let camera = PerspectiveCamera()
            camera.camera.fieldOfViewInDegrees = 55
            camera.look(at: .zero, from: SIMD3(0.9, 0.25, 0.9), relativeTo: nil)
            content.add(camera)
        }
        .background(Color(red: 0.012, green: 0, blue: 0.035))
        .ignoresSafeArea()
    }

    static func hasSkeleton(_ e: Entity) -> Bool {
        if let m = e.components[ModelComponent.self], !m.mesh.contents.skeletons.isEmpty { return true }
        return e.children.contains { hasSkeleton($0) }
    }
}

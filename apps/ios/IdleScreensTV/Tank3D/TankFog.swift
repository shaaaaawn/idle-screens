import CoreGraphics
import RealityKit
import UIKit

/// three.js `Fog(fogColor, 60, 500)` (tank.ts) without a depth buffer: the
/// fog factor is three's `smoothstep(near, far, viewDepth)`, applied to each
/// fish as opacity — the ground behind it is the fog colour, so a fading fish
/// sinks into the fog as on the web — and baked into the floor's texture.
///
/// A depth post-process is the exact port, but on the tvOS 26.5 simulator
/// RealityKit's post-process depth reads NaN everywhere; revisit on hardware.
@available(tvOS 26.0, *)
struct TankFog: Sendable {
    var eye: SIMD3<Float>
    var forward: SIMD3<Float>
    var near: Float = 60
    var far: Float = 500
    /// fogColor default `#030009`, 0–255.
    var color: SIMD3<Float> = SIMD3(3, 0, 9)

    func factor(at p: SIMD3<Float>) -> Float {
        let depth = simd_dot(p - eye, forward)
        let x = min(max((depth - near) / (far - near), 0), 1)
        return x * x * (3 - 2 * x)
    }

    /// A flat disc of `radius` at y = 0, its colour fogged per texel.
    @MainActor
    func floor(radius: Float, color floorColor: SIMD3<Float>, size: Int = 512) -> ModelEntity? {
        var px = [UInt8](repeating: 0, count: size * size * 4)
        for j in 0..<size {
            for i in 0..<size {
                let x = (Float(i) + 0.5) / Float(size) * 2 - 1, z = (Float(j) + 0.5) / Float(size) * 2 - 1
                let k = factor(at: SIMD3(x * radius, 0, z * radius))
                let c = floorColor + (color - floorColor) * k
                let o = (j * size + i) * 4
                let inside = x * x + z * z <= 1
                px[o] = UInt8(c.x.rounded()); px[o + 1] = UInt8(c.y.rounded()); px[o + 2] = UInt8(c.z.rounded())
                px[o + 3] = inside ? 255 : 0
            }
        }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let image = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent),
              let texture = try? TextureResource(image: image, options: .init(semantic: .color)) else { return nil }
        var material = UnlitMaterial()
        material.color = .init(texture: .init(texture))
        material.blending = .transparent(opacity: .init(floatLiteral: 1))
        return ModelEntity(mesh: .generatePlane(width: radius * 2, depth: radius * 2), materials: [material])
    }
}

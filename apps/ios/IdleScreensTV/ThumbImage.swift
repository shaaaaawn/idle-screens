import SwiftUI
import UIKit

/// Channel thumb with a validity gate: the server can serve a technically
/// valid but pure-black JPEG (broken thumb pipeline), which AsyncImage would
/// happily display as a broken-looking tile. Load the data ourselves, check
/// mean luminance on a tiny downsample, and fall back to designed art.
struct ThumbImage<Fallback: View>: View {
    let url: URL
    @ViewBuilder let fallback: Fallback

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                fallback
            }
        }
        .task(id: url) {
            guard image == nil, !failed else { return }
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let loaded = UIImage(data: data),
                  Self.hasVisibleContent(loaded) else {
                failed = true
                return
            }
            image = loaded
        }
    }

    /// Mean luminance over a 16×16 downsample — rejects black/near-black
    /// frames the same way SceneVisibility rejects invisible specs.
    static func hasVisibleContent(_ image: UIImage) -> Bool {
        let size = CGSize(width: 16, height: 16)
        let renderer = UIGraphicsImageRenderer(size: size)
        let small = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let cg = small.cgImage,
              let data = cg.dataProvider?.data,
              let bytes = CFDataGetBytePtr(data) else { return true }
        let bytesPerPixel = cg.bitsPerPixel / 8
        let count = CFDataGetLength(data) / bytesPerPixel
        var total = 0.0
        for i in 0..<count {
            let p = i * bytesPerPixel
            total += 0.2126 * Double(bytes[p]) + 0.7152 * Double(bytes[p + 1])
                + 0.0722 * Double(bytes[p + 2])
        }
        return (total / Double(count)) > 4.0
    }
}

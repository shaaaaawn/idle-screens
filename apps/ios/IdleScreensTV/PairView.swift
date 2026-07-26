import SwiftUI
import CoreImage.CIFilterBuiltins

/// "Pair iPhone" — shows a short-lived QR encoding the pairing universal link,
/// with the code as a readable fallback for typing into the phone by hand.
struct PairView: View {
    @Environment(TVAppState.self) private var app

    var body: some View {
        VStack(spacing: 40) {
            Text("Pair iPhone")
                .font(.largeTitle.bold())

            if let pair = app.pairCode {
                if let qr = Self.qrImage(for: pair.url) {
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 480, height: 480)
                        .padding(24)
                        .background(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 24))
                }

                VStack(spacing: 12) {
                    Text("Scan with the idle screens app, or enter the code:")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text(pair.code)
                        .font(.system(size: 64, weight: .bold, design: .monospaced))
                        .kerning(12)
                }

                Text("The code works once and expires after a few minutes.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
            } else if app.isRequestingPairCode {
                ProgressView("Requesting code…")
            } else if let error = app.pairError {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            Button("New code") {
                Task { await app.requestPairCode() }
            }
            .disabled(app.isRequestingPairCode)
        }
        .padding(60)
        .task {
            await app.requestPairCode()
        }
    }

    /// Render the pairing URL as a QR code — CoreImage only, no dependencies.
    static func qrImage(for string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        // Integer upscale keeps modules on pixel boundaries; the Image view
        // adds .interpolation(.none) so resizing stays crisp.
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

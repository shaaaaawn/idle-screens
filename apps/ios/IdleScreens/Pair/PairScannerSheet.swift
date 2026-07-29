import SwiftUI
import UIKit
import VisionKit

/// Camera sheet that scans the TV's pairing QR. Falls back to a plain
/// explanation on hardware without Live Text support (and the simulator,
/// which has no camera) — manual code entry lives on the TV tab itself.
struct PairScannerSheet: View {
    let onCode: @MainActor (String) -> Void
    /// Escape hatch. A QR that won't read — glare, distance, a Mac that only
    /// ever shows a code — must not be a dead end inside the camera sheet.
    var onEnterManually: (@MainActor () -> Void)?
    @Environment(\.dismiss) private var dismiss

    private var cameraAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    var body: some View {
        NavigationStack {
            Group {
                if cameraAvailable {
                    ZStack(alignment: .bottom) {
                        QRScannerView { payload in
                            // `claimPairCode` unwraps URLs itself now, so the
                            // payload goes through whole — one parser, not two.
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            onCode(payload)
                        }
                        aimingGuide
                    }
                } else {
                    ContentUnavailableView(
                        "Camera unavailable",
                        systemImage: "camera.on.rectangle",
                        description: Text("Scanning needs a device with a camera. Enter the code from your screen instead.")
                    )
                }
            }
            .navigationTitle("Scan pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let onEnterManually {
                    Button {
                        onEnterManually()
                    } label: {
                        Label("Enter the code instead", systemImage: "keyboard")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                            .glassCapsule(shape: Capsule())
                    }
                    .padding(.bottom, 16)
                }
            }
        }
    }

    /// Framing hint — without one, a full-bleed camera gives no clue where to
    /// point, and people hold the phone too far back to resolve the code.
    private var aimingGuide: some View {
        RoundedRectangle(cornerRadius: 24)
            .strokeBorder(.white.opacity(0.85), lineWidth: 3)
            .frame(width: 220, height: 220)
            .frame(maxHeight: .infinity)
            .allowsHitTesting(false)
    }
}

/// Thin wrapper over VisionKit's DataScannerViewController, QR-only.
private struct QRScannerView: UIViewControllerRepresentable {
    let onScan: @MainActor (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .fast,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        try? scanner.startScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: @MainActor (String) -> Void
        private var delivered = false

        init(onScan: @escaping @MainActor (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !delivered else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
                    delivered = true
                    onScan(payload)
                    return
                }
            }
        }
    }
}

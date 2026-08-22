import SwiftUI
import CoreImage.CIFilterBuiltins

/// "Pair iPhone" — the TV's auth surface. QR pairing IS the token entry on
/// tvOS (typing an `isk_…` token with the remote would violate every 10-foot
/// input rule), so this screen carries the weight: ambient brand backdrop,
/// numbered steps, an Apple-style segmented code, and a live expiry countdown
/// that mints a fresh code automatically when the old one lapses.
struct PairView: View {
    @Environment(TVAppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var paired = false

    var body: some View {
        ZStack {
            // Ambient scene, dimmed — the pairing screen is still the brand.
            FallbackSceneView(channelId: "pairing", caption: "")
                .opacity(0.5)
                .ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0.35)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            HStack(alignment: .center, spacing: 100) {
                // Left: what this is, and the steps.
                VStack(alignment: .leading, spacing: 36) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("PAIR YOUR IPHONE")
                            .font(.system(size: 24, weight: .semibold))
                            .kerning(2.2)
                            .foregroundStyle(Color.appAccent)
                        Text("Steer this TV\nfrom your phone")
                            .font(.system(size: 58, weight: .bold))
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 22) {
                        PairStep(number: 1, text: "Open the idle screens app on iPhone")
                        PairStep(number: 2, text: "Tap Pair TV in the VJ tab")
                        PairStep(number: 3, text: "Scan the code — or type it in")
                    }

                    Text("Pairing lets your phone switch channels and VJ scenes on this TV. The code works once.")
                        .font(.system(size: 25))
                        .foregroundStyle(.white.opacity(0.5))
                        .frame(maxWidth: 620, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // Right: the QR card + code.
                VStack(spacing: 32) {
                    if paired {
                        // The phone's post-claim ack push landed — pairing is
                        // proven end-to-end, not just requested.
                        PairedCard()
                    } else if let pair = app.pairCode {
                        if let qr = Self.qrImage(for: pair.url) {
                            Image(uiImage: qr)
                                .interpolation(.none)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 440, height: 440)
                                .padding(28)
                                .background(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 28))
                                .shadow(color: .black.opacity(0.5), radius: 40, y: 16)
                        }

                        CodeTiles(code: pair.code)

                        if let expiresAt = pair.expiresAt {
                            ExpiryCountdown(expiresAt: expiresAt) {
                                Task { await app.requestPairCode() }
                            }
                            .id(pair.code)
                        }
                    } else if app.isRequestingPairCode {
                        StatusCard(icon: "qrcode",
                                   title: "Getting a code…",
                                   detail: nil,
                                   spinning: true)
                    } else if let error = app.pairError {
                        StatusCard(icon: "wifi.exclamationmark",
                                   title: "Couldn't reach idlescreens.com",
                                   detail: error,
                                   spinning: false)
                        Button("Try again") {
                            Task { await app.requestPairCode() }
                        }
                    }
                }
                .frame(width: 560)
            }
            .padding(.horizontal, 120)
        }
        .task { await app.requestPairCode() }
        .onChange(of: app.phonePushAt) {
            guard !paired else { return }
            withAnimation(.easeInOut(duration: 0.35)) { paired = true }
            // Linger long enough to be read from the couch, then bow out.
            Task {
                try? await Task.sleep(for: .seconds(4))
                dismiss()
            }
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

// MARK: - Pieces

private struct PairStep: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(spacing: 18) {
            Text("\(number)")
                .font(.system(size: 25, weight: .bold, design: .rounded))
                .foregroundStyle(.black)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.appAccent))
            Text(text)
                .font(.system(size: 29))
                .foregroundStyle(.white.opacity(0.85))
        }
    }
}

/// Apple-pairing-style segmented code: one tile per character.
private struct CodeTiles: View {
    let code: String

    var body: some View {
        HStack(spacing: 14) {
            ForEach(Array(code.enumerated()), id: \.offset) { _, char in
                Text(String(char))
                    .font(.system(size: 52, weight: .bold, design: .monospaced))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 92)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(.white.opacity(0.10))
                            .overlay(RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(.white.opacity(0.18), lineWidth: 1))
                    )
            }
        }
    }
}

/// Live countdown; fires `onExpired` once when the code lapses so a fresh
/// one appears without anyone touching the remote.
private struct ExpiryCountdown: View {
    let expiresAt: Int
    let onExpired: () -> Void
    @State private var fired = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = Double(expiresAt) / 1000 - context.date.timeIntervalSince1970
            if remaining > 0 {
                Text("new code in \(Int(remaining) / 60):\(String(format: "%02d", Int(remaining) % 60))")
                    .font(.system(size: 25))
                    .foregroundStyle(.white.opacity(0.45))
                    .monospacedDigit()
            } else {
                Text("refreshing code…")
                    .font(.system(size: 25))
                    .foregroundStyle(.white.opacity(0.45))
                    .onAppear {
                        guard !fired else { return }
                        fired = true
                        onExpired()
                    }
            }
        }
    }
}

/// The success moment: the phone claimed the code and its ack push reached
/// this TV over the socket — pairing proven end-to-end.
private struct PairedCard: View {
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 26) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 96))
                .foregroundStyle(Color.appAccent)
                .symbolRenderingMode(.hierarchical)
                .scaleEffect(appeared ? 1 : 0.6)
                .animation(.spring(duration: 0.5, bounce: 0.4), value: appeared)
            Text("Paired")
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(.white)
            Text("Your iPhone has the wheel —\nswitch channels and VJ from the couch.")
                .font(.system(size: 25))
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .frame(width: 496, height: 400)
        .background(
            RoundedRectangle(cornerRadius: 28)
                .fill(.white.opacity(0.06))
                .overlay(RoundedRectangle(cornerRadius: 28)
                    .strokeBorder(Color.appAccent.opacity(0.35), lineWidth: 1))
        )
        .onAppear { appeared = true }
        .transition(.opacity)
    }
}

private struct StatusCard: View {
    let icon: String
    let title: String
    let detail: String?
    let spinning: Bool

    var body: some View {
        VStack(spacing: 20) {
            if spinning {
                ProgressView()
                    .scaleEffect(1.6)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 52))
                    .foregroundStyle(.white.opacity(0.6))
            }
            Text(title)
                .font(.system(size: 31, weight: .semibold))
                .foregroundStyle(.white)
            if let detail {
                Text(detail)
                    .font(.system(size: 23))
                    .foregroundStyle(.white.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
        }
        .frame(width: 496, height: 400)
        .background(
            RoundedRectangle(cornerRadius: 28)
                .fill(.white.opacity(0.06))
                .overlay(RoundedRectangle(cornerRadius: 28)
                    .strokeBorder(.white.opacity(0.12), lineWidth: 1))
        )
    }
}

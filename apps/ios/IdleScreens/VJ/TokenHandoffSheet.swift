import SwiftUI

struct TokenHandoff: Identifiable {
    let credential: ChannelCredential
    let token: String
    var id: String { credential.channelId }
}

/// Handing a steering token to another person.
///
/// This was originally scoped as "share the token for backup". Backup stopped
/// being the reason the moment tokens became iCloud-synchronizable — your own
/// devices already have it. What remains is **delegation**, which is a
/// different act with different consequences, so it gets different words:
///
/// - Whoever holds the token can publish to the channel as freely as you can.
/// - There is no per-person revoke. A capability token is not an account, so
///   the only undo is rotating the token, which cuts off *every* holder —
///   including you, on every device.
///
/// Both facts are stated before the share sheet opens, not after.
struct TokenHandoffSheet: View {
    let handoff: TokenHandoff
    @Environment(\.dismiss) private var dismiss
    @State private var acknowledged = false

    /// A link the recipient can act on in one tap, rather than two paste
    /// operations they have to get right. Parsed by `ChannelTokenFormat`.
    private var deepLink: String {
        "idlescreens://channel/\(handoff.credential.channelId)?token=\(handoff.token)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(handoff.credential.label)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                        Text(handoff.credential.channelId)
                            .font(.footnote.monospaced())
                            .foregroundStyle(Color.textTertiary)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        consequence(
                            icon: "person.2.fill",
                            title: "They can publish to this channel",
                            detail: "Anyone holding this token steers it exactly as you do — swap scenes, change params, put it to sleep.")
                        consequence(
                            icon: "exclamationmark.triangle.fill",
                            title: "You can't un-share it for one person",
                            detail: "A token isn't an account. The only undo is rotating it, which locks out everyone who has it — you included, on every device.")
                        consequence(
                            icon: "icloud.fill",
                            title: "Your own devices don't need this",
                            detail: "Tokens sync through iCloud Keychain already. This is for giving someone else control.")
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
                    }

                    Toggle(isOn: $acknowledged) {
                        Text("I understand what I'm handing over")
                            .font(.subheadline)
                            .foregroundStyle(Color.textPrimary)
                    }
                    .tint(Color.appSuccess)

                    if acknowledged {
                        ShareLink(item: deepLink) {
                            Label("Hand over control…", systemImage: "square.and.arrow.up")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .foregroundStyle(Color.appBackground)
                                .background(Color.textPrimary, in: Capsule())
                        }
                        .transition(.opacity)
                    }
                }
                .padding(20)
            }
            .background(Color.appBackground)
            .navigationTitle("Give control")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .animation(.easeOut(duration: 0.2), value: acknowledged)
        }
        .presentationDetents([.large])
    }

    private func consequence(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
            }
        }
    }
}

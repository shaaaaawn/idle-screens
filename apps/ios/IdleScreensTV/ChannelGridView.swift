import SwiftUI

/// Focus-driven gallery of channel poster cards.
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @State private var manualChannelId = ""
    @State private var showingSettings = false

    private let columns = [GridItem(.adaptive(minimum: 380), spacing: 48)]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Fixed header — kept out of the ScrollView so focus-driven
                // scrolling can never push it off screen.
                HStack {
                    Text("idle screens")
                        .font(.system(size: 56, weight: .bold))
                        .foregroundStyle(Color.textPrimary)
                    Spacer()
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 32))
                    }
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal, 80)
                .padding(.top, 40)
                .padding(.bottom, 32)

                ScrollView {
                    VStack(spacing: 48) {
                        if app.channels.isEmpty, !app.isLoadingGallery {
                            ContentUnavailableView(
                                "No channels",
                                systemImage: "tv",
                                description: Text(app.galleryError ?? "")
                            )
                        } else {
                            LazyVGrid(columns: columns, spacing: 48) {
                                ForEach(app.channels) { channel in
                                    Button {
                                        app.selectChannel(channel.id)
                                    } label: {
                                        ChannelCard(channel: channel)
                                    }
                                    .buttonStyle(.card)
                                }
                            }
                        }

                        HStack(spacing: 24) {
                            TextField("Enter channel ID", text: $manualChannelId)
                                .frame(width: 480)
                            Button("Watch") {
                                let id = manualChannelId.trimmingCharacters(in: .whitespaces)
                                if !id.isEmpty { app.selectChannel(id) }
                            }
                            .disabled(manualChannelId.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    .padding(.horizontal, 80)
                    .padding(.bottom, 60)
                }
            }
            .background(Color.appBackground.ignoresSafeArea())
            .navigationDestination(isPresented: Binding(
                get: { app.selectedChannelId != nil },
                set: { if !$0 { app.exitChannel() } }
            )) {
                ScreenSaverView()
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
            }
            // A paired phone can push a channel while Settings (the pairing
            // QR) is up — drop the sheet so the saver is actually visible.
            .onChange(of: app.selectedChannelId) {
                if app.selectedChannelId != nil { showingSettings = false }
            }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }
}

private struct ChannelCard: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Fixed 16:9 poster frame — thumbs arrive in arbitrary aspects
            // (portrait phone, square, landscape). Color.clear owns the frame
            // (a scaledToFill image ignores the height proposal and would
            // inflate the card); the overlaid image overflows and is clipped.
            Color.clear
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .overlay {
                    AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure:
                            ThumbPlaceholder(label: channel.displayLabel)
                        default:
                            ThumbPlaceholder(label: channel.displayLabel)
                                .opacity(0.5)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(channel.displayLabel)
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                HStack(spacing: 12) {
                    if let viewers = channel.viewers {
                        Label("\(viewers)", systemImage: "eye")
                    }
                    if let tags = channel.tags, !tags.isEmpty {
                        Text(tags.joined(separator: " · "))
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.textSecondary)
            }
        }
    }
}

/// Shown when a channel has no thumb (404/empty) — reads as intentional,
/// not broken.
private struct ThumbPlaceholder: View {
    let label: String

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.appSurfaceRaised, Color.appBackground],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(spacing: 16) {
                Circle()
                    .fill(Color.appPrimary.opacity(0.7))
                    .frame(width: 28, height: 28)
                Text(label)
                    .font(.headline)
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}

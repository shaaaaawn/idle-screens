import SwiftUI

/// 10-foot gallery: cinematic hero for the first featured channel,
/// "featured" and "channels" sections of 16:9 cards below the fold.
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @State private var manualChannelId = ""
    @State private var showingSettings = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 48), count: 3)

    private var featured: [PublicChannel] {
        app.channels.filter { $0.tags?.contains("featured") == true }
    }
    private var hero: PublicChannel? { featured.first }
    private var featuredRail: [PublicChannel] { Array(featured.dropFirst()) }
    private var rest: [PublicChannel] {
        app.channels.filter { $0.tags?.contains("featured") != true }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Fixed header — kept out of the ScrollView so focus-driven
                // scrolling can never push it off screen.
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("idle screens")
                            .font(.system(size: 56, weight: .bold))
                            .foregroundStyle(Color.textPrimary)
                        Text("ambient channels · \(app.channels.count) live")
                            .font(.callout)
                            .foregroundStyle(Color.textSecondary)
                    }
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
                .padding(.bottom, 40)

                GeometryReader { geo in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 64) {
                            if app.channels.isEmpty, !app.isLoadingGallery {
                                ContentUnavailableView(
                                    "No channels",
                                    systemImage: "tv",
                                    description: Text(app.galleryError ?? "")
                                )
                            } else {
                                if let hero {
                                    Button {
                                        app.selectChannel(hero.id)
                                    } label: {
                                        // Cap at ~58% of the space left after the
                                        // tab bar + header so the whole hero —
                                        // scrim, label, pills — stays above the fold.
                                        HeroChannelCard(channel: hero, height: geo.size.height * 0.58)
                                    }
                                    .buttonStyle(.card)
                                }

                                if !featuredRail.isEmpty {
                                    ChannelSection(title: "featured") {
                                        CardGrid(channels: featuredRail, columns: columns)
                                    }
                                }

                                if !rest.isEmpty {
                                    ChannelSection(title: "channels") {
                                        CardGrid(channels: rest, columns: columns)
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
                        .padding(.bottom, 80)
                    }
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
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }
}

// MARK: - Sections

private struct ChannelSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text(title)
                .font(.title3)
                .foregroundStyle(Color.textSecondary)
            content
        }
    }
}

private struct CardGrid: View {
    @Environment(TVAppState.self) private var app
    let channels: [PublicChannel]
    let columns: [GridItem]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 48) {
            ForEach(channels) { channel in
                Button {
                    app.selectChannel(channel.id)
                } label: {
                    ChannelCard(channel: channel)
                }
                .buttonStyle(.card)
            }
        }
    }
}

// MARK: - Card

private struct ChannelCard: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Fixed 16:9 poster frame — thumbs arrive in arbitrary aspects;
            // channels without one get deterministic generative art.
            AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ProceduralChannelArt(channelId: channel.id)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(channel.displayLabel)
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 12) {
                    if let viewers = channel.viewers {
                        Label("\(viewers)", systemImage: "eye")
                    }
                    if let tags = channel.tags, !tags.isEmpty {
                        Text(tags.prefix(3).joined(separator: " · "))
                            .lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.textSecondary)
            }
        }
    }
}

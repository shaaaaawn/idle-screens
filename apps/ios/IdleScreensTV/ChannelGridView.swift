import SwiftUI

/// Focus-driven gallery of channel poster cards.
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @State private var manualChannelId = ""
    @State private var showingSettings = false

    private let columns = [GridItem(.adaptive(minimum: 380), spacing: 48)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 40) {
                    Text("idle screens")
                        .font(.system(size: 56, weight: .bold))
                        .foregroundStyle(Color.textPrimary)
                        .padding(.horizontal, 80)

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
                        .padding(.horizontal, 80)
                    }

                    HStack(spacing: 24) {
                        TextField("Enter channel ID", text: $manualChannelId)
                            .frame(width: 480)
                        Button("Watch") {
                            let id = manualChannelId.trimmingCharacters(in: .whitespaces)
                            if !id.isEmpty { app.selectChannel(id) }
                        }
                        .disabled(manualChannelId.trimmingCharacters(in: .whitespaces).isEmpty)
                        Button {
                            showingSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                    }
                    .padding(.horizontal, 80)
                    .padding(.bottom, 60)
                }
                .padding(.top, 60)
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

private struct ChannelCard: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Color.appSurfaceRaised
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
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

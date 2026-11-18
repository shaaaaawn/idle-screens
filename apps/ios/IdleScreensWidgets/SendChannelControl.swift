import AppIntents
import SwiftUI
import WidgetKit

/// The Control Center (and Lock Screen, and Action button) control: one tap
/// puts a chosen channel on your screens — or, left unconfigured, moves them
/// on to the next channel in your quick list.
@available(iOS 18.0, *)
struct SendChannelControl: ControlWidget {
    static let kind = "com.hermosalabs.idlescreens.send-control"

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: Self.kind, intent: SendControlConfiguration.self) { config in
            ControlWidgetButton(action: SendTileIntent(channelId: config.channel?.id, screenId: config.screen?.id)) {
                Label(config.channel?.label ?? "Next channel",
                      systemImage: config.channel == nil ? "forward.end" : "tv")
            }
        }
        .displayName("Send to Screens")
        .description("Put a channel on your screens, or move them on to the next one.")
    }
}

@available(iOS 18.0, *)
struct SendControlConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Send to Screens"

    @Parameter(title: "Channel", description: "Leave empty to move on to the next channel.")
    var channel: ChannelEntity?

    @Parameter(title: "Screen", description: "Leave empty for the screens you last chose in the app, or every paired screen if none is left.")
    var screen: ScreenEntity?

    init() {}
}

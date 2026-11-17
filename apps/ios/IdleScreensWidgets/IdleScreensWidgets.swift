import SwiftUI
import WidgetKit

@main
struct IdleScreensWidgets: WidgetBundle {
    var body: some Widget {
        ScreensWidget()
        if #available(iOS 18.0, *) {
            SendChannelControl()
        }
    }
}

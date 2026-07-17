import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// LSUIElement in Info.plist keeps us out of the Dock; .accessory mirrors that
// when running the bare executable during development.
app.setActivationPolicy(.accessory)
app.run()

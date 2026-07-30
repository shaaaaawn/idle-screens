import AppKit

/// One place for "who is allowed to drive this Mac, and what is it allowed to
/// drive" — pairing a phone (QR + code + live link state) and the capability
/// tokens for claimed channels.
///
/// This replaces two dead-end alerts: a pair code you had to retype from a
/// modal, and a token prompt that only appeared *after* a cast had already
/// failed.
///
/// Not in scope: syncing tokens between the phone and the Mac. Moving a
/// credential between devices is its own security design, not UI polish — the
/// two Keychains stay separate, and this window only shows what this Mac holds.
final class AccessWindow: NSObject, NSWindowDelegate {
  private var window: NSWindow?
  private let defaults = UserDefaults.standard

  // Pair section
  private var qrView = NSImageView()
  private var codeField = NSTextField(labelWithString: "——————")
  private var expiryField = NSTextField(labelWithString: "")
  private var linkStateField = NSTextField(labelWithString: "")
  private var copyLinkButton = NSButton()
  private var current: PairDevice.PairCode?
  private var countdown: Timer?

  // Token section
  private var tokenList = NSPopUpButton()
  private var tokenStateField = NSTextField(labelWithString: "")

  /// Chained so the menu's own state observer keeps firing — assigning over
  /// `PairLink.onStateChange` would silently stop the menu updating.
  private var previousLinkObserver: (() -> Void)?

  func show() {
    if let window {
      window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      refreshLinkState()
      refreshTokens()
      mint()  // a code older than its 5-minute TTL is worse than no code
      return
    }

    let content = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 430))
    buildPairSection(in: content)
    buildTokenSection(in: content)

    let win = NSWindow(
      contentRect: content.frame, styleMask: [.titled, .closable],
      backing: .buffered, defer: false)
    win.title = "Pairing & Access"
    win.contentView = content
    win.center()
    win.isReleasedWhenClosed = false
    win.delegate = self
    window = win

    previousLinkObserver = PairLink.shared.onStateChange
    PairLink.shared.onStateChange = { [weak self] in
      self?.previousLinkObserver?()
      self?.refreshLinkState()
    }

    refreshLinkState()
    refreshTokens()
    mint()

    NSApp.activate(ignoringOtherApps: true)
    win.makeKeyAndOrderFront(nil)
  }

  // MARK: - Pairing

  private func buildPairSection(in content: NSView) {
    let title = label("Pair a phone", size: 16, weight: .semibold)
    title.frame = NSRect(x: 24, y: 388, width: 300, height: 22)
    content.addSubview(title)

    let hint = label(
      "Scan with the idle screens iPhone app (TV tab → Add), or type the code.",
      size: 11, weight: .regular)
    hint.frame = NSRect(x: 24, y: 366, width: 400, height: 18)
    hint.textColor = .secondaryLabelColor
    content.addSubview(hint)

    qrView.frame = NSRect(x: 24, y: 176, width: 180, height: 180)
    qrView.imageScaling = .scaleProportionallyUpOrDown
    qrView.wantsLayer = true
    qrView.layer?.backgroundColor = NSColor.white.cgColor
    qrView.layer?.cornerRadius = 6
    content.addSubview(qrView)

    codeField.frame = NSRect(x: 224, y: 300, width: 270, height: 44)
    codeField.font = .monospacedSystemFont(ofSize: 34, weight: .medium)
    content.addSubview(codeField)

    expiryField.frame = NSRect(x: 224, y: 278, width: 270, height: 18)
    expiryField.font = .systemFont(ofSize: 11)
    expiryField.textColor = .secondaryLabelColor
    content.addSubview(expiryField)

    let regenerate = NSButton(title: "New Code", target: self, action: #selector(regenerate(_:)))
    regenerate.frame = NSRect(x: 224, y: 238, width: 100, height: 28)
    regenerate.bezelStyle = .rounded
    content.addSubview(regenerate)

    copyLinkButton = NSButton(title: "Copy Link", target: self, action: #selector(copyLink(_:)))
    copyLinkButton.frame = NSRect(x: 330, y: 238, width: 100, height: 28)
    copyLinkButton.bezelStyle = .rounded
    content.addSubview(copyLinkButton)

    linkStateField.frame = NSRect(x: 224, y: 196, width: 270, height: 34)
    linkStateField.font = .systemFont(ofSize: 11)
    linkStateField.maximumNumberOfLines = 2
    linkStateField.lineBreakMode = .byWordWrapping
    content.addSubview(linkStateField)
  }

  private func mint() {
    codeField.stringValue = "······"
    expiryField.stringValue = "Requesting a code…"
    qrView.image = nil
    PairDevice.mintCode(channelId: defaults.string(forKey: "channelId")) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let pair):
        self.current = pair
        self.codeField.stringValue = pair.code
        self.qrView.image = pair.url.flatMap { QRCode.image(for: $0.absoluteString) }
        self.copyLinkButton.isEnabled = pair.url != nil
        NSLog(
          "[idle-screens] pair code minted: \(pair.code) link=\(pair.url?.absoluteString ?? "none")"
            + " qr=\(self.qrView.image == nil ? "failed" : "ok")")
        self.startCountdown()
      case .failure(let error):
        self.current = nil
        self.codeField.stringValue = "——————"
        self.expiryField.stringValue = error.localizedDescription
        self.copyLinkButton.isEnabled = false
      }
    }
  }

  private func startCountdown() {
    countdown?.invalidate()
    tickCountdown()
    // Invalidated in windowWillClose — this app runs for weeks, so a timer per
    // open/close cycle would pile up.
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      self?.tickCountdown()
    }
    RunLoop.main.add(timer, forMode: .common)
    countdown = timer
  }

  private func tickCountdown() {
    guard let remaining = current?.secondsRemaining else {
      expiryField.stringValue = "Enter this on the phone within 5 minutes."
      return
    }
    if remaining <= 0 {
      countdown?.invalidate()
      countdown = nil
      expiryField.stringValue = "Expired — click New Code."
      qrView.image = nil
      codeField.stringValue = "——————"
      return
    }
    expiryField.stringValue = String(
      format: "Expires in %d:%02d", Int(remaining) / 60, Int(remaining) % 60)
  }

  private func refreshLinkState() {
    let connected = PairLink.shared.isConnected
    let dot = connected ? "●" : "○"
    var text =
      connected
      ? "\(dot) Reachable — a paired phone can steer this Mac now."
      : "\(dot) Not connected to the relay; pushes won't arrive yet."
    if let channel = PairLink.shared.lastPushedChannel, let at = PairLink.shared.lastPushAt {
      let ago = Int(Date().timeIntervalSince(at))
      text += "\nLast push: \(channel) (\(ago < 60 ? "\(ago)s" : "\(ago / 60)m") ago)"
    }
    linkStateField.stringValue = text
    linkStateField.textColor = connected ? .secondaryLabelColor : .systemOrange
  }

  @objc private func regenerate(_ sender: NSButton) { mint() }

  @objc private func copyLink(_ sender: NSButton) {
    guard let url = current?.url else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(url.absoluteString, forType: .string)
  }

  // MARK: - Channel tokens

  private func buildTokenSection(in content: NSView) {
    let divider = NSBox(frame: NSRect(x: 24, y: 160, width: 472, height: 1))
    divider.boxType = .separator
    content.addSubview(divider)

    let title = label("Channel access", size: 16, weight: .semibold)
    title.frame = NSRect(x: 24, y: 126, width: 300, height: 22)
    content.addSubview(title)

    let hint = label(
      "Claimed channels need a capability token to publish to. Tokens are kept in your Keychain.",
      size: 11, weight: .regular)
    hint.frame = NSRect(x: 24, y: 106, width: 472, height: 18)
    hint.textColor = .secondaryLabelColor
    content.addSubview(hint)

    tokenList.frame = NSRect(x: 24, y: 66, width: 240, height: 26)
    tokenList.target = self
    tokenList.action = #selector(tokenSelectionChanged(_:))
    content.addSubview(tokenList)

    let add = NSButton(title: "Add Token…", target: self, action: #selector(addToken(_:)))
    add.frame = NSRect(x: 274, y: 64, width: 110, height: 28)
    add.bezelStyle = .rounded
    content.addSubview(add)

    let remove = NSButton(title: "Remove", target: self, action: #selector(removeToken(_:)))
    remove.frame = NSRect(x: 390, y: 64, width: 100, height: 28)
    remove.bezelStyle = .rounded
    content.addSubview(remove)

    tokenStateField.frame = NSRect(x: 24, y: 24, width: 472, height: 32)
    tokenStateField.font = .systemFont(ofSize: 11)
    tokenStateField.textColor = .secondaryLabelColor
    tokenStateField.maximumNumberOfLines = 2
    tokenStateField.lineBreakMode = .byWordWrapping
    content.addSubview(tokenStateField)
  }

  private func refreshTokens() {
    let channels = ChannelToken.allChannels()
    tokenList.removeAllItems()
    if channels.isEmpty {
      tokenList.addItem(withTitle: "No tokens stored")
      tokenList.isEnabled = false
    } else {
      tokenList.addItems(withTitles: channels)
      tokenList.isEnabled = true
    }
    tokenSelectionChanged(tokenList)
  }

  @objc private func tokenSelectionChanged(_ sender: NSPopUpButton) {
    let channels = ChannelToken.allChannels()
    guard let selected = sender.titleOfSelectedItem, channels.contains(selected) else {
      tokenStateField.stringValue =
        "The open channels (default, lobby, studio) need no token. Add one for a channel you claimed."
      return
    }
    tokenStateField.stringValue = "“\(selected)” — token stored. Casting to it will authorize."
  }

  @objc private func addToken(_ sender: NSButton) {
    let alert = NSAlert()
    alert.messageText = "Add a channel token"
    alert.informativeText =
      "The capability token is what a claimed channel returned when it was created. It is the only authorization — there are no accounts."

    let stack = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 58))
    let channelField = NSComboBox(frame: NSRect(x: 0, y: 30, width: 280, height: 26))
    channelField.addItems(withObjectValues: ChannelCatalog.cached.map(\.id))
    channelField.completes = true
    channelField.placeholderString = "Channel id"
    stack.addSubview(channelField)
    let tokenField = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    tokenField.placeholderString = "Capability token"
    stack.addSubview(tokenField)
    alert.accessoryView = stack

    alert.addButton(withTitle: "Save")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let channel = channelField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let token = tokenField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !channel.isEmpty, !token.isEmpty else { return }
    // Same Keychain key ChannelClient reads before publishing — one store.
    ChannelToken.save(token, for: channel)
    refreshTokens()
    tokenList.selectItem(withTitle: channel)
    tokenSelectionChanged(tokenList)
  }

  @objc private func removeToken(_ sender: NSButton) {
    guard let selected = tokenList.titleOfSelectedItem,
      ChannelToken.allChannels().contains(selected)
    else { return }
    ChannelToken.delete(for: selected)
    refreshTokens()
  }

  // MARK: - Plumbing

  private func label(_ text: String, size: CGFloat, weight: NSFont.Weight) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.font = .systemFont(ofSize: size, weight: weight)
    field.lineBreakMode = .byWordWrapping
    field.maximumNumberOfLines = 0
    return field
  }

  func windowWillClose(_ notification: Notification) {
    countdown?.invalidate()
    countdown = nil
    PairLink.shared.onStateChange = previousLinkObserver
    previousLinkObserver = nil
    window = nil
  }
}

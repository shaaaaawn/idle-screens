import Foundation

/// Keeps this Mac reachable for phone pushes.
///
/// The webview only holds a channel socket while the saver is actually
/// showing, so a Mac sitting in bundled-saver mode never registered with the
/// relay: pairing "succeeded" on the phone but every push came back
/// "has not connected yet". This is the always-on control socket (same idea
/// as the tvOS app's): connected whenever the app runs, re-registering the
/// device id so `/api/pair/push` has somewhere to deliver, and surfacing
/// `{"type":"switch"}` so the phone can retarget this screen.
final class PairLink: NSObject {
  static let shared = PairLink()

  /// Fired on main when a paired phone pushes a channel.
  var onSwitch: ((String) -> Void)?
  /// Fired on main whenever connection state changes (for the menu).
  var onStateChange: (() -> Void)?

  private(set) var isConnected = false {
    didSet {
      guard isConnected != oldValue else { return }
      DispatchQueue.main.async { self.onStateChange?() }
    }
  }
  private(set) var lastPushedChannel: String?
  private(set) var lastPushAt: Date?

  private var task: URLSessionWebSocketTask?
  private var session: URLSession!
  private var channelId: String = "default"
  private var reconnectDelay: TimeInterval = 1
  private var stopped = true

  private override init() {
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }

  /// Connect (or reconnect on a different channel). Safe to call repeatedly.
  func start(channelId: String?) {
    let target = (channelId?.isEmpty == false ? channelId! : "default")
    if !stopped, target == self.channelId, task != nil { return }
    self.channelId = target
    stopped = false
    connect()
  }

  func stop() {
    stopped = true
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    isConnected = false
  }

  private func connect() {
    guard !stopped else { return }
    task?.cancel(with: .goingAway, reason: nil)
    var components = URLComponents(string: "wss://idlescreens.com/c/\(channelId)/ws")!
    components.queryItems = [URLQueryItem(name: "device", value: PairDevice.deviceId)]
    guard let url = components.url else { return }
    let socket = session.webSocketTask(with: url)
    task = socket
    socket.resume()
    receive(on: socket)
  }

  private func receive(on socket: URLSessionWebSocketTask) {
    socket.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        if case .string(let text) = message { self.handle(text) }
        self.reconnectDelay = 1
        self.receive(on: socket)
      case .failure:
        self.isConnected = false
        self.scheduleReconnect()
      }
    }
  }

  private func handle(_ text: String) {
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = object["type"] as? String
    else { return }
    if type == "switch", let channel = object["channelId"] as? String, !channel.isEmpty {
      lastPushedChannel = channel
      lastPushAt = Date()
      // Follow the push: this socket moves to the new channel too, so the
      // next push still finds us.
      channelId = channel
      DispatchQueue.main.async {
        self.onSwitch?(channel)
        self.onStateChange?()
      }
      connect()
    }
  }

  private func scheduleReconnect() {
    guard !stopped else { return }
    let delay = reconnectDelay
    reconnectDelay = min(delay * 2, 60)
    DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
      self?.connect()
    }
  }
}

extension PairLink: URLSessionWebSocketDelegate {
  func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol proto: String?
  ) {
    isConnected = true
    reconnectDelay = 1
  }

  func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
  ) {
    isConnected = false
    scheduleReconnect()
  }
}

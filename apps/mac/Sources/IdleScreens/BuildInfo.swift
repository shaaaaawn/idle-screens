import Foundation

/// Build provenance stamped into the bundle by `scripts/build-app.sh` —
/// answers "is this menu-bar app my local dev build or the deployed
/// release?" at a glance during development.
struct BuildInfo: Decodable {
  let kind: String
  let commit: String
  let date: String

  static let current: BuildInfo = {
    guard
      let url = Bundle.main.url(forResource: "build-info", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let info = try? JSONDecoder().decode(BuildInfo.self, from: data)
    else {
      // Running straight from `swift run` / .build with no bundle stamp.
      return BuildInfo(kind: "unstamped", commit: "unknown", date: "unknown")
    }
    return info
  }()

  static var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  static var summary: String {
    """
    Version \(appVersion)
    Build: \(current.kind) · \(current.commit) · \(current.date)
    Server: https://idlescreens.com
    """
  }
}

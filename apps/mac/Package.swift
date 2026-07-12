// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "IdleScreens",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "IdleScreens",
      path: "Sources/IdleScreens"
    )
  ]
)

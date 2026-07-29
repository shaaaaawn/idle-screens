import XCTest

@testable import IdleScreens

/// The menu shows a handful of channels out of 40+, so *which* handful is the
/// whole design: recently played first, featured to fill, never more than the
/// limit (the rest live behind "All Channels…").
final class ChannelCatalogTests: XCTestCase {
  private func entry(_ id: String, featured: Bool = false) -> ChannelCatalog.Entry {
    ChannelCatalog.Entry(id: id, label: nil, tags: featured ? ["featured"] : [])
  }

  private var catalog: [ChannelCatalog.Entry] {
    [
      entry("lobby", featured: true), entry("default", featured: true), entry("studio"),
      entry("qa-noint-9826"), entry("probe-22066"), entry("evals-color-field"),
      entry("upnext"), entry("upnext2"), entry("upnext3"), entry("scrubdemo"),
    ]
  }

  func testRecentComeFirstInOrder() {
    let list = ChannelCatalog.menuList(all: catalog, recent: ["studio", "upnext2"], limit: 4)
    XCTAssertEqual(list.map(\.id), ["studio", "upnext2", "lobby", "default"])
  }

  func testFeaturedFillWhenNothingPlayedYet() {
    let list = ChannelCatalog.menuList(all: catalog, recent: [], limit: 3)
    XCTAssertEqual(list.prefix(2).map(\.id), ["lobby", "default"])
    XCTAssertEqual(list.count, 3)
  }

  func testNoDuplicatesWhenARecentIsAlsoFeatured() {
    let list = ChannelCatalog.menuList(all: catalog, recent: ["lobby"], limit: 8)
    XCTAssertEqual(list.filter { $0.id == "lobby" }.count, 1)
    XCTAssertEqual(list.first?.id, "lobby")
  }

  func testUnknownRecentIdsAreSkipped() {
    // A channel that was deleted server-side shouldn't leave a dead menu row.
    let list = ChannelCatalog.menuList(all: catalog, recent: ["gone-forever"], limit: 2)
    XCTAssertEqual(list.map(\.id), ["lobby", "default"])
  }

  func testRespectsLimit() {
    XCTAssertEqual(ChannelCatalog.menuList(all: catalog, recent: [], limit: 8).count, 8)
    XCTAssertEqual(ChannelCatalog.menuList(all: [], recent: ["x"], limit: 8).count, 0)
  }
}

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

  // MARK: - The slim listing

  /// The URL `refresh` fetches is the slim list: `?slim=1` as a query, not
  /// `%3F` in the path (which `appendingPathComponent` would make of it — a
  /// 404), on whatever server the app points at.
  func testRefreshFetchesTheSlimListing() throws {
    let prod = try XCTUnwrap(URL(string: "https://idlescreens.com"))
    XCTAssertEqual(ChannelCatalog.listURL(base: prod)?.absoluteString,
                   "https://idlescreens.com/api/channels?slim=1")
    let local = try XCTUnwrap(URL(string: "http://localhost:8787"))
    XCTAssertEqual(ChannelCatalog.listURL(base: local)?.absoluteString,
                   "http://localhost:8787/api/channels?slim=1")
  }

  /// Three rows verbatim from prod `GET /api/channels?slim=1` (2026-11-16):
  /// a plain scene, a classic saver, a sequence. Every field `Entry`
  /// reads is there; nothing it needs was in the scene the slim list drops.
  func testDecodesASlimPayloadCapturedFromProd() throws {
    let json = #"""
      [{"id":"default","label":"default","tags":["featured"],"remixOf":null,"categoryId":null,"categorySort":0,"protected":true,"sleeping":false,"viewers":2,"saver":"Endless","lastEvent":{"at":1794874546017,"actor":"admin","summary":"policy cleared","model":null,"intent":null,"harness":null},"createdAt":0},
       {"id":"fishtank","label":"Fishtank","tags":["featured","fish","aquarium","ambient","water"],"remixOf":null,"categoryId":null,"categorySort":0,"protected":true,"sleeping":false,"viewers":0,"saver":"metaquarium","lastEvent":{"at":1793692980001,"actor":"Spin","summary":"scheduled metaquarium went live","model":"claude-opus-5-5","intent":null,"harness":"claude-code"},"createdAt":1785624106445},
       {"id":"swan-lake","label":"Swan Lake — a triptych","tags":["ballet","greenroom","premiere","triptych"],"remixOf":null,"categoryId":"ballets-of-light","categorySort":3,"protected":true,"sleeping":false,"viewers":0,"saver":"Swan Lake — a triptych","lastEvent":{"at":1788634232565,"actor":"pi-ensemble:stage-manager","summary":"recalled swan-lake from preset “checkpoint-act-1”","model":"claude-fable-5-1","intent":null,"harness":"claude-code"},"createdAt":1788633046004}]
      """#
    let entries = try JSONDecoder().decode([ChannelCatalog.Entry].self, from: Data(json.utf8))
    XCTAssertEqual(entries.map(\.id), ["default", "fishtank", "swan-lake"])
    XCTAssertEqual(entries.map(\.displayLabel), ["default", "Fishtank", "Swan Lake — a triptych"])
    XCTAssertEqual(entries.map(\.isFeatured), [true, true, false])
    let menu = ChannelCatalog.menuList(all: entries, recent: [], limit: 8)
    XCTAssertEqual(menu.map(\.id), ["default", "fishtank", "swan-lake"])
  }
}

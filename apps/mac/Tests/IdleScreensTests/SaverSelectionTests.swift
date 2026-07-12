import XCTest
@testable import IdleScreens

final class SaverSelectionTests: XCTestCase {
  private let catalog = ["a", "b", "c", "d"]

  func testBuildPoolExcludesHidden() {
    let pool = SaverSelection.buildPool(
      catalogIds: catalog,
      hidden: ["b", "d"],
      favorites: []
    )
    XCTAssertEqual(pool, ["a", "c"])
  }

  func testBuildPoolPrefersFavoritesWhenAnyVisible() {
    let pool = SaverSelection.buildPool(
      catalogIds: catalog,
      hidden: [],
      favorites: ["c"]
    )
    XCTAssertEqual(pool, ["c"])
  }

  func testBuildPoolFallsBackToCatalogWhenAllHidden() {
    let pool = SaverSelection.buildPool(
      catalogIds: catalog,
      hidden: Set(catalog),
      favorites: []
    )
    XCTAssertEqual(pool, catalog)
  }

  func testStartIndexHonorsPinnedSaver() {
    let pool = ["x", "y", "z"]
    XCTAssertEqual(SaverSelection.startIndex(pool: pool, pinnedSaver: "y"), 1)
  }

  func testStartIndexUsesRandomSlotWhenUnpinned() {
    let pool = ["x", "y", "z"]
    XCTAssertEqual(SaverSelection.startIndex(pool: pool, pinnedSaver: nil, randomIndex: 5), 2)
  }

  func testSaverAtWrapsNegativeAndOverflowIndices() {
    let pool = ["a", "b", "c"]
    XCTAssertEqual(SaverSelection.saverAt(pool: pool, index: -1), "c")
    XCTAssertEqual(SaverSelection.saverAt(pool: pool, index: 4), "b")
  }

  func testSaverIdUsesValidPerDisplayOverride() {
    let id = SaverSelection.saverId(
      forDisplay: "1",
      perDisplayOverride: "fluid",
      catalogIds: catalog + ["fluid"],
      globalSaverId: "a"
    )
    XCTAssertEqual(id, "fluid")
  }

  func testSaverIdFallsBackToGlobalWhenOverrideInvalid() {
    let id = SaverSelection.saverId(
      forDisplay: "1",
      perDisplayOverride: "missing",
      catalogIds: catalog,
      globalSaverId: "b"
    )
    XCTAssertEqual(id, "b")
  }
}

final class SaverCatalogLoaderTests: XCTestCase {
  func testDecodeCatalogParsesSaversJSON() throws {
    let json = """
    [{"id":"fluid","label":"Fluid"},{"id":"warp","label":"Warp"}]
    """.data(using: .utf8)!
    let entries = try XCTUnwrap(SaverCatalogLoader.decodeCatalog(from: json))
    XCTAssertEqual(entries.count, 2)
    XCTAssertEqual(entries[0].id, "fluid")
    XCTAssertEqual(entries[1].label, "Warp")
  }

  func testDecodeCatalogRejectsEmptyArray() {
    let json = "[]".data(using: .utf8)!
    XCTAssertNil(SaverCatalogLoader.decodeCatalog(from: json))
  }

  func testResolveFallsBackWhenDataMissing() {
    let fallback = [SaverEntry(id: "a", label: "A")]
    let resolved = SaverCatalogLoader.resolve(data: nil, fallback: fallback)
    XCTAssertEqual(resolved.count, 1)
    XCTAssertEqual(resolved[0].id, "a")
    XCTAssertEqual(resolved[0].label, "A")
  }
}

final class SaverCatalogTests: XCTestCase {
  func testCompiledCatalogIncludesCoreSavers() {
    XCTAssertTrue(SaverCatalog.ids.contains("fluid"))
    XCTAssertTrue(SaverCatalog.ids.contains("mystify"))
    XCTAssertGreaterThanOrEqual(SaverCatalog.all.count, 20)
  }
}

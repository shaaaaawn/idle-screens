import XCTest
@testable import IdleScreensTV

final class CategoryShelfTests: XCTestCase {

    func testCategoriesCatalogDecodes() throws {
        // Shape of GET /api/categories (channels list is ignored on purpose —
        // membership comes from each channel's categoryId).
        let json = """
        {"categories":[{"id":"style-studies","title":"Style studies",
          "subtitle":"Eval-derived artist-style channels","sort":0,
          "heroChannelId":null,"channels":[{"id":"x"}]}]}
        """
        struct Wrap: Decodable { let categories: [ChannelCategory] }
        let catalog = try JSONDecoder().decode(Wrap.self, from: Data(json.utf8)).categories
        XCTAssertEqual(catalog.count, 1)
        XCTAssertEqual(catalog.first?.id, "style-studies")
        XCTAssertEqual(catalog.first?.displayTitle, "Style studies")
        XCTAssertEqual(catalog.first?.subtitle, "Eval-derived artist-style channels")
    }

    func testDisplayTitleFallsBackToId() {
        let bare = ChannelCategory(id: "late-night", title: nil, subtitle: nil, sort: nil)
        XCTAssertEqual(bare.displayTitle, "late-night")
    }

    func testChannelDecodesCategoryMembership() throws {
        let json = """
        {"id":"evals-pointillist-field","label":"Pointillist Field",
         "categoryId":"style-studies","categorySort":2}
        """
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(json.utf8))
        XCTAssertEqual(channel.categoryId, "style-studies")
        XCTAssertEqual(channel.categorySort, 2)
    }

    func testChannelWithoutCategoryStaysUncategorized() throws {
        let channel = try JSONDecoder().decode(PublicChannel.self,
                                               from: Data(#"{"id":"default"}"#.utf8))
        XCTAssertNil(channel.categoryId)
        XCTAssertNil(channel.categorySort)
    }
}

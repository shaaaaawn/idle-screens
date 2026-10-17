import XCTest
@testable import IdleScreensTV

/// The TV reads `fishMix` with the engine's grammar. The golden table below
/// is the engine's own output — `parseFishMix` and `lofiCast` from
/// packages/saver-metaquarium, run over every live prod mix (2026-10-17)
/// plus edge cases — so any drift between the two parsers fails here.
/// Regenerate by running those two functions over each `mix` and re-pasting.
final class FishMixTests: XCTestCase {

    private struct Golden: Decodable {
        struct E: Decodable { let id: Int; let breed: String; let count: Int; let style: String?; let size: Double? }
        let mix: String
        let entries: [E]
        let lofi13: [Int]?
    }

    private static let golden: [Golden] = {
        try! JSONDecoder().decode([Golden].self, from: Data(goldenJSON.utf8))
    }()

    func testEveryMixParsesExactlyLikeTheEngine() {
        XCTAssertGreaterThan(Self.golden.count, 40)
        for g in Self.golden {
            let got = FishMix.parse(g.mix)
            XCTAssertEqual(got.map(\.id), g.entries.map(\.id), "ids: \(g.mix)")
            XCTAssertEqual(got.map(\.breed), g.entries.map(\.breed), "breeds: \(g.mix)")
            XCTAssertEqual(got.map(\.count), g.entries.map(\.count), "counts: \(g.mix)")
            XCTAssertEqual(got.map(\.style), g.entries.map(\.style), "styles: \(g.mix)")
            XCTAssertEqual(got.map(\.size), g.entries.map(\.size), "sizes: \(g.mix)")
        }
    }

    /// The TV and lofi.ts must cast the same BREED in every slot — breed
    /// drives the rng draws, so a mismatch shifts the whole tank's layout.
    func testCastMatchesTheBrowserMirrorBreedForBreed() {
        for g in Self.golden {
            let tv = AquariumField.castIndices(fishMix: g.mix, cap: 13)
            guard let lofi = g.lofi13 else {
                XCTAssertNil(tv, "lofi casts nobody, so the seed picks: \(g.mix)")
                continue
            }
            let tvBreeds = (tv ?? []).map { AquariumField.Breed.of(id: AquariumField.castIds[$0]) }
            XCTAssertEqual(tvBreeds, lofi.map(AquariumField.Breed.of(id:)), g.mix)
        }
    }

    func testSuffixesNoLongerEatTheCast() {
        XCTAssertEqual(FishMix.parse("seahorse:3@hover").count, 3)
        XCTAssertEqual(FishMix.parse("457@drift").map(\.id), [457])
        XCTAssertEqual(FishMix.parse("seahorse:2*1.5").map(\.size), [1.5, 1.5])
        // Unminted breeds are species: one entry, a plain count.
        XCTAssertEqual(FishMix.parse("crab:3@bottom").map(\.count), [3])
        XCTAssertEqual(AquariumField.castIndices(fishMix: "angelfish:3@hover", cap: 13)?.count, 3)
    }
}

private let goldenJSON = #"""
[
{
"mix": "dot:1,dolphin:1,babyfish:3",
"entries": [
{
"id": 612,
"breed": "dot",
"count": 1,
"style": null,
"size": null
},
{
"id": 613,
"breed": "dolphin",
"count": 1,
"style": null,
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 3,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "dot:1",
"entries": [
{
"id": 612,
"breed": "dot",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "snail:6",
"entries": [
{
"id": 611,
"breed": "snail",
"count": 6,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "23,301,64,88,130,201",
"entries": [
{
"id": 23,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 301,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 64,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 88,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 130,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 201,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
23,
301,
64,
88,
130,
201
]
},
{
"mix": "23,301,64",
"entries": [
{
"id": 23,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 301,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 64,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
23,
301,
64
]
},
{
"mix": "angelfish:3@drift, seahorse:2@drift, betafish:1@drift, seaturtle:1@drift, crab:1@bottom",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 323,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 389,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 1,
"breed": "betafish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": "bottom",
"size": null
}
],
"lofi13": [
257,
323,
389,
457,
476,
1,
497
]
},
{
"mix": "angelfish:5@school*1.3, seaturtle:1@patrol, seahorse:1@hover, crab:1",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 1.3
},
{
"id": 296,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 1.3
},
{
"id": 336,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 1.3
},
{
"id": 376,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 1.3
},
{
"id": 416,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 1.3
},
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "patrol",
"size": null
},
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
257,
296,
336,
376,
416,
497,
457
]
},
{
"mix": "octopus:1, shark:1, babyfish:1*1.6, crab:3@bottom, dori:2@surface",
"entries": [
{
"id": 610,
"breed": "octopus",
"count": 1,
"style": null,
"size": null
},
{
"id": 605,
"breed": "shark",
"count": 1,
"style": null,
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
},
{
"id": 606,
"breed": "crab",
"count": 3,
"style": "bottom",
"size": null
},
{
"id": 608,
"breed": "dori",
"count": 2,
"style": "surface",
"size": null
}
],
"lofi13": null
},
{
"mix": "blowfish:1*1.2, shark:1*0.9, babyfish:1*1.6",
"entries": [
{
"id": 601,
"breed": "blowfish",
"count": 1,
"style": null,
"size": 1.2
},
{
"id": 605,
"breed": "shark",
"count": 1,
"style": null,
"size": 0.9
},
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
}
],
"lofi13": null
},
{
"mix": "blowfish:2*1.5, babyfish:1*1.6",
"entries": [
{
"id": 601,
"breed": "blowfish",
"count": 2,
"style": null,
"size": 1.5
},
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
}
],
"lofi13": null
},
{
"mix": "glowfish:1*1.4, babyfish:2*1.8",
"entries": [
{
"id": 603,
"breed": "glowfish",
"count": 1,
"style": null,
"size": 1.4
},
{
"id": 604,
"breed": "babyfish",
"count": 2,
"style": null,
"size": 1.8
}
],
"lofi13": null
},
{
"mix": "angelfish:3@hover",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 323,
"breed": "angelfish",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 389,
"breed": "angelfish",
"count": 1,
"style": "hover",
"size": null
}
],
"lofi13": [
257,
323,
389
]
},
{
"mix": "starfish:6",
"entries": [
{
"id": 609,
"breed": "starfish",
"count": 6,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "seahorse:2*1.5, betafish:1*1.3, seahorse:2@follow*0.7",
"entries": [
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": null,
"size": 1.5
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": null,
"size": 1.5
},
{
"id": 1,
"breed": "betafish",
"count": 1,
"style": null,
"size": 1.3
},
{
"id": 458,
"breed": "seahorse",
"count": 1,
"style": "follow",
"size": 0.7
},
{
"id": 477,
"breed": "seahorse",
"count": 1,
"style": "follow",
"size": 0.7
}
],
"lofi13": [
457,
476,
1,
458,
477
]
},
{
"mix": "17:1, 42:1, crab:5",
"entries": [
{
"id": 17,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 42,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 5,
"style": null,
"size": null
}
],
"lofi13": [
17,
42
]
},
{
"mix": "starfish:6, dori:2*0.55",
"entries": [
{
"id": 609,
"breed": "starfish",
"count": 6,
"style": null,
"size": null
},
{
"id": 608,
"breed": "dori",
"count": 2,
"style": null,
"size": 0.55
}
],
"lofi13": null
},
{
"mix": "blowfish:1*1.2, babyfish:1*1.6, crab:1",
"entries": [
{
"id": 601,
"breed": "blowfish",
"count": 1,
"style": null,
"size": 1.2
},
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "glowfish:1, babyfish:1*1.6, dori:1",
"entries": [
{
"id": 603,
"breed": "glowfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
},
{
"id": 608,
"breed": "dori",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "seaturtle:1@patrol, seahorse:3@hover, angelfish:2@drift, betafish:1@drift",
"entries": [
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "patrol",
"size": null
},
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 470,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 483,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 356,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 1,
"breed": "betafish",
"count": 1,
"style": "drift",
"size": null
}
],
"lofi13": [
497,
457,
470,
483,
257,
356,
1
]
},
{
"mix": "angelfish:5@school, seahorse:2@hover, seaturtle:1@patrol",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 296,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 336,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 376,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 416,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "patrol",
"size": null
}
],
"lofi13": [
257,
296,
336,
376,
416,
457,
476,
497
]
},
{
"mix": "glowfish:1@patrol*1.2, angelfish:2@drift",
"entries": [
{
"id": 603,
"breed": "glowfish",
"count": 1,
"style": "patrol",
"size": 1.2
},
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 356,
"breed": "angelfish",
"count": 1,
"style": "drift",
"size": null
}
],
"lofi13": [
257,
356
]
},
{
"mix": "angelfish:5@school, seahorse:2@hover, crab:1@bottom",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 296,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 336,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 376,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 416,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": null
},
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": "hover",
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": "bottom",
"size": null
}
],
"lofi13": [
257,
296,
336,
376,
416,
457,
476
]
},
{
"mix": "glowfish:2@hover, hackerfish:1@patrol, octopus:1@bottom, crab:1, shark:1@patrol, babyfish:2@pair",
"entries": [
{
"id": 603,
"breed": "glowfish",
"count": 2,
"style": "hover",
"size": null
},
{
"id": 602,
"breed": "hackerfish",
"count": 1,
"style": "patrol",
"size": null
},
{
"id": 610,
"breed": "octopus",
"count": 1,
"style": "bottom",
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": null,
"size": null
},
{
"id": 605,
"breed": "shark",
"count": 1,
"style": "patrol",
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 2,
"style": "pair",
"size": null
}
],
"lofi13": null
},
{
"mix": "dori:3,blowfish:2,crab:2,octopus:1,starfish:2,babyfish:4",
"entries": [
{
"id": 608,
"breed": "dori",
"count": 3,
"style": null,
"size": null
},
{
"id": 601,
"breed": "blowfish",
"count": 2,
"style": null,
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 2,
"style": null,
"size": null
},
{
"id": 610,
"breed": "octopus",
"count": 1,
"style": null,
"size": null
},
{
"id": 609,
"breed": "starfish",
"count": 2,
"style": null,
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 4,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "dolphin:3,dori:6",
"entries": [
{
"id": 613,
"breed": "dolphin",
"count": 3,
"style": null,
"size": null
},
{
"id": 608,
"breed": "dori",
"count": 6,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "7,23,42,88,130,201,250,64",
"entries": [
{
"id": 7,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 23,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 42,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 88,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 130,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 201,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 250,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 64,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
7,
23,
42,
88,
130,
201,
250,
64
]
},
{
"mix": "457@drift,461@drift,465@drift,469@drift,475@pair,477@pair,479@pair,481@pair",
"entries": [
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 461,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 465,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 469,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
},
{
"id": 475,
"breed": "seahorse",
"count": 1,
"style": "pair",
"size": null
},
{
"id": 477,
"breed": "seahorse",
"count": 1,
"style": "pair",
"size": null
},
{
"id": 479,
"breed": "seahorse",
"count": 1,
"style": "pair",
"size": null
},
{
"id": 481,
"breed": "seahorse",
"count": 1,
"style": "pair",
"size": null
}
],
"lofi13": [
457,
461,
465,
469,
475,
477,
479,
481
]
},
{
"mix": "shark:1@chase, dori:23@school",
"entries": [
{
"id": 605,
"breed": "shark",
"count": 1,
"style": "chase",
"size": null
},
{
"id": 608,
"breed": "dori",
"count": 23,
"style": "school",
"size": null
}
],
"lofi13": null
},
{
"mix": "dori:3@drift, blowfish:1, octopus:1@bottom, crab:1, starfish:1, seaturtle:1@patrol",
"entries": [
{
"id": 608,
"breed": "dori",
"count": 3,
"style": "drift",
"size": null
},
{
"id": 601,
"breed": "blowfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 610,
"breed": "octopus",
"count": 1,
"style": "bottom",
"size": null
},
{
"id": 606,
"breed": "crab",
"count": 1,
"style": null,
"size": null
},
{
"id": 609,
"breed": "starfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "patrol",
"size": null
}
],
"lofi13": [
497
]
},
{
"mix": "crab:3@bottom",
"entries": [
{
"id": 606,
"breed": "crab",
"count": 3,
"style": "bottom",
"size": null
}
],
"lofi13": null
},
{
"mix": "babyfish:1*1.6",
"entries": [
{
"id": 604,
"breed": "babyfish",
"count": 1,
"style": null,
"size": 1.6
}
],
"lofi13": null
},
{
"mix": "seahorse:2*1.5",
"entries": [
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": null,
"size": 1.5
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": null,
"size": 1.5
}
],
"lofi13": [
457,
476
]
},
{
"mix": "457@drift",
"entries": [
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": "drift",
"size": null
}
],
"lofi13": [
457
]
},
{
"mix": "shark:1@patrol*1.5",
"entries": [
{
"id": 605,
"breed": "shark",
"count": 1,
"style": "patrol",
"size": 1.5
}
],
"lofi13": null
},
{
"mix": "300:12",
"entries": [
{
"id": 300,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 301,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 299,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 302,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 298,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 303,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 297,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 304,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 296,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 305,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 295,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 306,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
300,
301,
299,
302,
298,
303,
297,
304,
296,
305,
295,
306
]
},
{
"mix": "betafish:5",
"entries": [
{
"id": 1,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 52,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 103,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 154,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 205,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
1,
52,
103,
154,
205
]
},
{
"mix": "12:999",
"entries": [
{
"id": 12,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 13,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 11,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 14,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 10,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 15,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 9,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 16,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 8,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 17,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 7,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 18,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 6,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 19,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 5,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 20,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 4,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 21,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 3,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 22,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 2,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 23,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 1,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
},
{
"id": 24,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
12,
13,
11,
14,
10,
15,
9,
16,
8,
17,
7,
18,
6
]
},
{
"mix": "dragon:4,,:",
"entries": [],
"lofi13": null
},
{
"mix": "seahorse:",
"entries": [],
"lofi13": null
},
{
"mix": "457:0",
"entries": [],
"lofi13": null
},
{
"mix": "13",
"entries": [
{
"id": 13,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
13
]
},
{
"mix": " SeaHorse :2",
"entries": [
{
"id": 457,
"breed": "seahorse",
"count": 1,
"style": null,
"size": null
},
{
"id": 476,
"breed": "seahorse",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
457,
476
]
},
{
"mix": "12@nosuchstyle",
"entries": [
{
"id": 12,
"breed": "betafish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
12
]
},
{
"mix": "snail:5,babyfish:4",
"entries": [
{
"id": 611,
"breed": "snail",
"count": 5,
"style": null,
"size": null
},
{
"id": 604,
"breed": "babyfish",
"count": 4,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "257:3,257:2",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 258,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 259,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 260,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
},
{
"id": 261,
"breed": "angelfish",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
257,
258,
259,
260,
261
]
},
{
"mix": "700",
"entries": [],
"lofi13": null
},
{
"mix": "607",
"entries": [],
"lofi13": null
},
{
"mix": "seaturtle:30",
"entries": [
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 498,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 499,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 500,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 501,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 502,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 503,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 504,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 505,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 506,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 507,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 508,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 509,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 510,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 511,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
},
{
"id": 512,
"breed": "seaturtle",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": [
497,
498,
499,
500,
501,
502,
503,
504,
505,
506,
507,
508,
509
]
},
{
"mix": "angelfish:2@school*9",
"entries": [
{
"id": 257,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 4
},
{
"id": 356,
"breed": "angelfish",
"count": 1,
"style": "school",
"size": 4
}
],
"lofi13": [
257,
356
]
},
{
"mix": "497@surface*0.1",
"entries": [
{
"id": 497,
"breed": "seaturtle",
"count": 1,
"style": "surface",
"size": 0.25
}
],
"lofi13": [
497
]
},
{
"mix": "dot",
"entries": [
{
"id": 612,
"breed": "dot",
"count": 1,
"style": null,
"size": null
}
],
"lofi13": null
},
{
"mix": "1:2:3",
"entries": [],
"lofi13": null
},
{
"mix": "crab:30",
"entries": [
{
"id": 606,
"breed": "crab",
"count": 24,
"style": null,
"size": null
}
],
"lofi13": null
}
]
"""#

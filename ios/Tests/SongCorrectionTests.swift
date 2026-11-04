import Foundation
import Testing
@testable import StatiCore
@Suite struct SongCorrectionTests {
    let owner = "11111111-1111-4111-8111-111111111111", computer = "22222222-2222-4222-8222-222222222222"
    var song: APIRecord { APIRecord(raw: ["id": .string(String(repeating: "a", count: 64)), "contentHash": .string(String(repeating: "b", count: 64)), "title": .string("Sample"), "text": .string("First line\nSecond line")]) }
    @Test func freezesAnExactRetriableIntentAndRejectsForeignReceipts() throws {
        var draft = SongCorrectionDraft(ownerID: owner, computerID: computer, song: song);draft.message = "  Check spelling  ";draft.quote = "First line";draft.replacement = "Corrected line"
        try draft.freeze();let before = draft.payload;try draft.freeze();#expect(draft.payload == before && draft.message == "Check spelling")
        draft.message = "Changed composer cannot mutate a sent intent";#expect(draft.payload == before)
        var receipt = draft.payload.fields;receipt["computerId"] = .string(computer)
        #expect(draft.accepts(.object(["correction": .object(receipt)])))
        receipt["songId"] = .string(String(repeating: "c", count: 64));#expect(!draft.accepts(.object(["correction": .object(receipt)])))
    }
    @Test func originalLyricsAndExactDraftAndImageBytesSurviveRestart() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString);defer { try? FileManager.default.removeItem(at: root) }
        let storage = try SongCorrectionStorage(ownerID: owner, computerID: computer, songID: song.id, root: root)
        var draft = SongCorrectionDraft(ownerID: owner, computerID: computer, song: song);draft.message = "Check this";draft.images = [try storage.stage(Data([1,2,3]))];try draft.freeze();try storage.save(draft)
        let restored = try #require(try storage.load());#expect(restored.payload == draft.payload);#expect(restored.song["text"] == song["text"]);#expect(try storage.bytes(restored.images[0]) == Data([1,2,3]))
        try Data([9]).write(to: storage.imageFile(restored.images[0]));#expect(throws: (any Error).self) { try storage.bytes(restored.images[0]) }
    }
    @Test func invalidSelectedLyricsCannotBeFrozenAndInvalidOwnersCannotChoosePaths() throws {
        var draft = SongCorrectionDraft(ownerID: owner, computerID: computer, song: song);draft.message = "Check";draft.quote = "Not in song"
        #expect(throws: (any Error).self) { try draft.freeze() }
        #expect(throws: (any Error).self) { try SongCorrectionStorage(ownerID: "../other", computerID: computer, songID: song.id) }
    }
}

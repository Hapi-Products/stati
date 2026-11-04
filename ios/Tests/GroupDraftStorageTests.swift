import Testing
import Foundation
@testable import StatiCore

@Suite @MainActor struct GroupDraftStorageTests {
    @Test func pendingIdentitySurvivesRestartAndCannotBeOverwrittenByAnEditableDraft() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = GroupDraftStorage(storageDirectory: root), owner = UUID().uuidString
        var draft = GroupEditDraft(ownerID: owner); draft.name = "Sunday group"; draft.memberIDs = [UUID().uuidString]
        _ = try draft.freeze(); try storage.save(draft)
        let saved = try #require(storage.load(ownerID: owner).first)
        #expect(saved.pending == draft.pending)
        var changed = saved; changed.allowCorrection(); changed.name = "Overwrite"
        #expect(throws: (any Error).self) { try storage.save(changed) }
        #expect(try storage.load(ownerID: owner).first?.pending == draft.pending)
        try storage.remove(saved); #expect(try storage.load(ownerID: owner).isEmpty)
    }
    @Test func aCorruptDraftBlocksNewWritesAndLeavesTheOriginalBytesIntact() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID().uuidString, folder = root.appending(path: owner)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let bad = folder.appending(path: UUID().uuidString + ".json"), bytes = Data("{broken group draft".utf8); try bytes.write(to: bad)
        let storage = GroupDraftStorage(storageDirectory: root)
        #expect(throws: (any Error).self) { try storage.load(ownerID: owner) }
        var draft = GroupEditDraft(ownerID: owner); draft.name = "New group"
        #expect(throws: (any Error).self) { try storage.save(draft) }
        #expect(try Data(contentsOf: bad) == bytes)
    }
    @Test func accountsRemainSeparateAndRemovingAMismatchedDraftIsRejected() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID().uuidString, other = UUID().uuidString, storage = GroupDraftStorage(storageDirectory: root)
        var draft = GroupEditDraft(ownerID: owner); draft.name = "Private membership draft"; try storage.save(draft)
        #expect(try storage.load(ownerID: other).isEmpty)
        var stale = draft; stale.name = "Old name"
        #expect(throws: (any Error).self) { try storage.remove(stale) }
        #expect(try storage.load(ownerID: owner).first?.name == draft.name)
    }
}

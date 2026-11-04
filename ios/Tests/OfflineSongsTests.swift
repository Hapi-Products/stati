import Foundation
import Testing
@testable import StatiCore

@Suite struct OfflineSongsTests {
    let owner = "11111111-1111-4111-8111-111111111111"
    let computer = "22222222-2222-4222-8222-222222222222"
    func song(_ id: String = String(repeating: "a", count: 64), text: String = "Exact lyrics\nSecond line") -> APIRecord { APIRecord(raw: ["id": .string(id), "title": .string("Shared title"), "text": .string(text), "groupName": .string("Choir")]) }
    @Test func cacheReopensExactLyricsAndCannotCrossAnOwnerOrComputer() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try OfflineSongStorage(ownerID: owner, computerID: computer, root: root)
        try storage.save([song()], complete: true)
        let reopened = try OfflineSongStorage(ownerID: owner, computerID: computer, root: root)
        #expect(try reopened.rows() == [song()])
        let other = try OfflineSongStorage(ownerID: "33333333-3333-4333-8333-333333333333", computerID: computer, root: root)
        #expect(try other.rows().isEmpty)
        #expect(throws: (any Error).self) { try OfflineSongStorage(ownerID: "../outside", computerID: computer, root: root) }
    }
    @Test func completeSnapshotRemovesOldAppRowsWhilePartialSnapshotsPreserveThem() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString); defer { try? FileManager.default.removeItem(at: root) }
        let storage = try OfflineSongStorage(ownerID: owner, computerID: computer, root: root)
        let a = song(), b = song(String(repeating: "b", count: 64))
        try storage.save([a], complete: true); try storage.save([b], complete: false)
        #expect(try storage.rows().count == 2)
        try storage.save([b], complete: true); #expect(try storage.rows() == [b])
        try storage.invalidate(); #expect(try storage.rows().isEmpty)
    }
    @Test func compatiblePDFExportsNeverOverwriteUserFilesAndReuseOnlyTheirOwnReceipt() throws {
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString), docs = root.appending(path: "Documents")
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try OfflineSongStorage(ownerID: owner, computerID: computer, root: root)
        let pdf = Data("%PDF-1.7\nSample PDF fixture".utf8)
        let first = try storage.savePDF(pdf, song: song(), version: "v1", documents: docs, accountName: "../My name", computerName: "Church/PC")
        #expect(first.path.hasPrefix(docs.path + "/")); #expect(first.pathExtension == "pdf")
        let edit = Data("%PDF-1.7\nUser annotations".utf8); try edit.write(to: first)
        let again = try storage.savePDF(pdf, song: song(), version: "v1", documents: docs, accountName: "../My name", computerName: "Church/PC")
        #expect(again == first); #expect(try Data(contentsOf: first) == edit)
        let changed = try storage.savePDF(pdf, song: song(text: "New lyrics"), version: "v2", documents: docs, accountName: "../My name", computerName: "Church/PC")
        #expect(changed != first); #expect(try Data(contentsOf: first) == edit)
        let other = try storage.savePDF(pdf, song: song(String(repeating: "b", count: 64)), version: "v1", documents: docs, accountName: "../My name", computerName: "Church/PC")
        #expect(other != changed && other != first)
    }
}

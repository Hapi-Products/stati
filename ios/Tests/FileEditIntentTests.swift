import Testing
@testable import StatiCore
import Foundation

struct FileEditIntentTests {
    private let fileID = "4ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    @Test func editTargetRejectsAmbiguousOrExternalFileRoutes() {
        #expect(FileEditTarget(path: "/api/group-materials/" + fileID + "/file")?.kind == "group")
        for path in ["https://example.org/api/group-materials/" + fileID + "/file", "/api/group-materials/../file", "/api/group-materials/" + fileID + "/file?x=1", "/api/tasks/invalid/images/" + fileID] { #expect(FileEditTarget(path: path) == nil) }
    }
    @Test func markupReceiptMustMatchTheExactSavedOperation() throws {
        let target = try #require(FileEditTarget(path: "/api/group-materials/" + fileID + "/file"))
        let edit = FileEditIntent(id: fileID, ownerID: fileID, sourcePath: "/api/group-materials/" + fileID + "/file", target: target, baseSHA256: String(repeating: "a", count: 64), sha256: String(repeating: "b", count: 64), bytes: 200, filename: "notes.pdf", contentFile: "content.pdf", state: .unconfirmed, createdAt: .now)
        let receipt: [String: JSONValue] = ["ok": .bool(true), "state": .string("committed"), "id": .string(edit.id), "targetKind": .string("group"), "targetId": .string(fileID), "baseSha256": .string(edit.baseSHA256), "sha256": .string(edit.sha256), "bytes": .number(200), "filename": .string(edit.filename)]
        #expect(edit.accepts(.object(receipt)))
        for key in ["id", "targetKind", "targetId", "baseSha256", "sha256", "filename", "state"] { var changed = receipt; changed[key] = .string("wrong"); #expect(!edit.accepts(.object(changed))) }
        var changed = receipt; changed["bytes"] = .number(199); #expect(!edit.accepts(.object(changed)))
        #expect(try JSONDecoder().decode(FileEditIntent.self, from: JSONEncoder().encode(edit)) == edit)
    }
}

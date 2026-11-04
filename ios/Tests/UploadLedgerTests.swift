import Foundation
import Testing
@testable import StatiCore

struct UploadLedgerTests {
    let owner = "b1111111-1111-4111-8111-111111111111"
    let device = "b2222222-2222-4222-8222-222222222222"
    let id = "b3333333-3333-4333-8333-333333333333"
    func fixture() -> UploadJob {
        UploadJob(id: id, userID: owner, deviceID: device, filename: "Song.txt", localFile: URL(fileURLWithPath: "/private/var/mobile/Containers/Data/Application/OLD/Library/Application Support/Uploads/\(owner)/\(id).upload"), bytes: 24, sha256: String(repeating: "a", count: 64), receipt: ["intentId": .string(id), "status": .string("queued")])
    }
    @Test func legacyContainerRelocationKeepsIdentityReceiptAndChecksum() throws {
        let original = fixture(), directory = URL(fileURLWithPath: "/new-container/Library/Application Support/Uploads/\(owner)", isDirectory: true)
        let rows = try UploadLedger.decode(JSONEncoder().encode([original]), ownerID: owner, directory: directory)
        #expect(rows.count == 1)
        #expect(rows[0].localFile == directory.appending(path: id + ".upload"))
        var expected = original; expected.localFile = rows[0].localFile
        #expect(rows[0] == expected)
    }
    @Test func newLedgerPersistsOnlyRelativeFileIdentity() throws {
        let bytes = try UploadLedger.encode([fixture()])
        #expect(!String(decoding: bytes, as: UTF8.self).contains("Containers/Data/Application"))
        let directory = URL(fileURLWithPath: "/another/Uploads/\(owner)", isDirectory: true)
        let restored = try UploadLedger.decode(bytes, ownerID: owner, directory: directory)
        #expect(restored[0].localFile == directory.appending(path: id + ".upload"))
        #expect(restored[0].receipt == fixture().receipt)
    }
    @Test func foreignOwnerAndUnexpectedPathRemainBlocked() throws {
        let directory = URL(fileURLWithPath: "/new/Uploads/\(owner)", isDirectory: true)
        var row = fixture(); row.localFile = URL(fileURLWithPath: "/other-account/\(id).upload")
        #expect(throws: (any Error).self) { try UploadLedger.decode(JSONEncoder().encode([row]), ownerID: owner, directory: directory) }
        row = fixture(); row.userID = device
        #expect(throws: (any Error).self) { try UploadLedger.decode(JSONEncoder().encode([row]), ownerID: owner, directory: directory) }
    }
    @Test func duplicateIdentityAndUnknownVersionAreRejected() throws {
        let directory = URL(fileURLWithPath: "/new/Uploads/\(owner)", isDirectory: true)
        #expect(throws: (any Error).self) { try UploadLedger.decode(JSONEncoder().encode([fixture(), fixture()]), ownerID: owner, directory: directory) }
        #expect(throws: (any Error).self) { try UploadLedger.decode(Data("{\"version\":99,\"jobs\":[]}".utf8), ownerID: owner, directory: directory) }
    }
}

import Foundation
import Testing
@testable import StatiCore

struct SongCommandTests {
    private var command: SongCommand {
        SongCommand(id: UUID().uuidString.lowercased(), ownerID: UUID().uuidString.lowercased(), computerID: UUID().uuidString.lowercased(), songID: String(repeating: "a", count: 64), contentHash: String(repeating: "b", count: 64), kind: .clone, groupName: "Choir")
    }
    private func receipt(_ command: SongCommand, status: String = "pending") -> JSONValue {
        .object(["id": .string(command.id), "songId": .string(command.songID), "contentHash": .string(command.contentHash), "kind": .string(command.kind.rawValue), "groupName": command.groupName.map(JSONValue.string) ?? .null, "status": .string(status)])
    }
    @Test func identitySurvivesReopeningAndCompletion() throws {
        let original = command
        let restored = try JSONDecoder().decode(SongCommand.self, from: JSONEncoder().encode(original))
        #expect(original == restored)
        #expect(restored.isValid)
        let accepted = try #require(restored.accepting(receipt(restored)))
        #expect(accepted.sameRequest(as: original))
        #expect(!accepted.isTerminal)
        let completed = try #require(accepted.accepting(receipt(accepted, status: "applied")))
        #expect(completed.sameRequest(as: original))
        #expect(completed.isTerminal)
        #expect(completed.accepting(receipt(completed, status: "pending")) == nil)
    }
    @Test func everyReceiptFingerprintMustMatch() {
        let command = command
        for key in ["id", "songId", "contentHash", "kind", "groupName", "status"] {
            var wrong = receipt(command).fields; wrong[key] = .string("wrong")
            #expect(command.accepting(.object(wrong)) == nil)
        }
        #expect(command.accepting(.object([:])) == nil)
    }
    @Test func sparseAcknowledgementCannotClaimCompletion() {
        let command = command
        let ack: JSONValue = .object(["id": .string(command.id), "kind": .string("clone"), "status": .string("pending")])
        #expect(command.accepting(ack) == nil)
        #expect(command.accepting(ack, acknowledgement: true)?.status == .pending)
        var finished = ack.fields; finished["status"] = .string("applied")
        #expect(command.accepting(.object(finished), acknowledgement: true) == nil)
    }
    @Test func groupNamesAndArchivePayloadUseCanonicalIdentity() {
        #expect(SongCommand.normalized("  Ｃｈｏｉｒ \n") == "Choir")
        #expect(command.body["action"].text == "clone")
        let original = command
        let invalid = SongCommand(id: original.id, ownerID: original.ownerID, computerID: original.computerID, songID: original.songID, contentHash: original.contentHash, kind: .clone, groupName: " Choir ")
        #expect(!invalid.isValid)
        let archive = SongCommand(id: original.id, ownerID: original.ownerID, computerID: original.computerID, songID: original.songID, contentHash: original.contentHash, kind: .archive, groupName: nil)
        #expect(archive.isValid)
        #expect(archive.body["groupName"] == .null)
    }
}

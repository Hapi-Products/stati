import Testing
import Foundation
@testable import StatiCore

@Suite struct GroupEditDraftTests {
    @Test func frozenCreationKeepsIdentityAndMembersAcrossRetryAndRestart() throws {
        var draft = GroupEditDraft(ownerID: "owner")
        draft.name = "  Sunday worship  "; draft.memberIDs = ["b", "a"]
        let intent = try draft.freeze()
        draft.name = "Changed after request"; draft.memberIDs = []
        #expect(try draft.freeze() == intent)
        let reopened = try JSONDecoder().decode(GroupEditDraft.self, from: JSONEncoder().encode(draft))
        #expect(reopened.id == draft.id)
        #expect(reopened.pending == intent)
        #expect(intent.name == "Sunday worship")
        #expect(intent.memberIDs == ["a", "b"])
    }
    @Test func membershipChangeUsesItsOriginalOwnerAndRevision() throws {
        var draft = GroupEditDraft(ownerID: "admin", id: "group", groupOwnerID: "leader", revision: 8)
        draft.name = "Choir"; draft.memberIDs = ["leader", "member"]
        let intent = try draft.freeze()
        #expect(intent.revision == 8)
        #expect(intent.groupOwnerID == "leader")
        #expect(intent.memberIDs == ["member"])
    }
    @Test func emptyOverlongAndControlNamesCannotFreezeARequest() {
        for name in ["  ", String(repeating: "a", count: 81), "Bad\u{0}name"] {
            var draft = GroupEditDraft(ownerID: "owner"); draft.name = name
            #expect(throws: (any Error).self) { try draft.freeze() }
            #expect(draft.pending == nil)
        }
    }
}

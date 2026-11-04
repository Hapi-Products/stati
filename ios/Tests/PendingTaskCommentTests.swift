import Testing
@testable import StatiCore

struct PendingTaskCommentTests {
    let id = "6ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    @Test func invalidAndOversizeCommentsDoNotCreateRetryIdentity() {
        #expect(PendingTaskComment(id: id, body: "  ") == nil)
        #expect(PendingTaskComment(id: "bad", body: "hello") == nil)
        #expect(PendingTaskComment(id: id, body: String(repeating: "a", count: 2001)) == nil)
    }
    @Test func lostReplyAcknowledgementMustMatchTaskIDCommentIDAndBody() throws {
        let pending = try #require(PendingTaskComment(id: id, body: " Saved comment "))
        #expect(pending.body == "Saved comment")
        func response(_ task: String, _ note: String, _ body: String) -> JSONValue { .object(["task": .object(["id": .string(task)]), "notes": .array([.object(["id": .string(note), "body": .string(body)])])]) }
        #expect(pending.isAcknowledged(response("task-one", id, "Saved comment"), taskID: "task-one"))
        #expect(!pending.isAcknowledged(response("other-task", id, "Saved comment"), taskID: "task-one"))
        #expect(!pending.isAcknowledged(response("task-one", "different-id", "Saved comment"), taskID: "task-one"))
        #expect(!pending.isAcknowledged(response("task-one", id, "Different comment"), taskID: "task-one"))
    }
    @Test func newerComposerTextSurvivesOldAcknowledgement() throws {
        let pending = try #require(PendingTaskComment(id: id, body: "First comment"))
        #expect(pending.composerAfterAcknowledgement("First comment") == "")
        #expect(pending.composerAfterAcknowledgement("Next comment while waiting") == "Next comment while waiting")
        #expect(pending.id == id)
        #expect(pending.body == "First comment")
    }
}

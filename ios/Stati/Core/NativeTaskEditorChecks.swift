#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeTaskEditorChecks {
    static func run() async {
        let store = AppStore(); await store.refresh(); store.taskDrafts = [:]
        var checks: [String: Bool] = [:]
        let first = NativeTaskEditorServer()
        let editor = TaskEditor(store: store, detail: first.detail, request: { path, method, body in try await first.request(path, method: method, body: body) })
        editor.comment = "First comment"; editor.cache()
        first.beforeReply = { editor.comment = "New text while waiting"; editor.cache() }
        await editor.note(); first.beforeReply = nil
        checks["newComposerSurvivesOldAcknowledgement"] = editor.comment == "New text while waiting" && !editor.hasPendingComment && first.notes.count == 1 && store.taskDrafts[editor.task.id]?["comment"]?.text == "New text while waiting"

        store.taskDrafts = [:]
        let lost = NativeTaskEditorServer(); lost.loseReply = true; lost.failLookup = true
        let initial = TaskEditor(store: store, detail: lost.detail, request: { path, method, body in try await lost.request(path, method: method, body: body) })
        initial.comment = "Preserve this intent"; initial.cache(); await initial.note()
        let saved = store.taskDrafts[initial.task.id]
        let frozenID = saved?["pendingCommentID"]?.text
        let frozenBody = saved?["pendingCommentBody"]?.text
        checks["lostReplyCachesExactIntent"] = initial.hasPendingComment && frozenID == lost.posts.first?["noteId"].text && frozenBody == "Preserve this intent" && lost.notes.count == 1
        lost.loseReply = false; lost.failLookup = false
        let reopened = TaskEditor(store: store, detail: lost.detail, request: { path, method, body in try await lost.request(path, method: method, body: body) })
        await reopened.note()
        checks["reopenRetriesSameIdentityWithoutDuplicate"] = lost.posts.count == 2 && lost.posts.allSatisfy { $0["noteId"].text == frozenID && $0["body"].text == frozenBody } && lost.notes.count == 1 && !reopened.hasPendingComment && reopened.comment.isEmpty

        store.taskDrafts = [:]
        let mismatched = NativeTaskEditorServer(); mismatched.wrongReceipt = true; mismatched.failLookup = true
        let uncertain = TaskEditor(store: store, detail: mismatched.detail, request: { path, method, body in try await mismatched.request(path, method: method, body: body) })
        uncertain.comment = "Keep until confirmed"; uncertain.cache(); await uncertain.note()
        checks["mismatchedReceiptKeepsDraft"] = uncertain.hasPendingComment && uncertain.comment == "Keep until confirmed" && store.taskDrafts[uncertain.task.id]?["pendingCommentBody"]?.text == "Keep until confirmed"

        let oldEpoch = store.accountEpoch
        mismatched.wrongReceipt = false; mismatched.failLookup = false
        mismatched.beforeReply = { await store.signOut() }
        await uncertain.note(); mismatched.beforeReply = nil
        let count = mismatched.posts.count
        uncertain.title = "Old editor after signout"; uncertain.cache(); await uncertain.save()
        checks["signoutFencesLateReplyAndOldEditor"] = store.accountEpoch != oldEpoch && !uncertain.isCurrentAccount && store.taskDrafts.isEmpty && mismatched.posts.count == count
        // Same account identifier alone cannot reactivate an editor from the old epoch.
        store.me = APIRecord(raw: NativeReview.viewer.fields)
        checks["sameAccountIDDoesNotReviveOldEpoch"] = !uncertain.isCurrentAccount && store.taskDrafts.isEmpty
        let report: JSONValue = .object(["checks": .object(checks.mapValues(JSONValue.bool)), "passed": .bool(checks.count == 6 && checks.values.allSatisfy { $0 }), "scope": .string("iOS Simulator model checks with injected task requests and protected sample drafts; no real task mutations or UI gestures")])
        try? JSONEncoder().encode(report).write(to: URL.applicationSupportDirectory.appending(path: "native-task-editor-checks.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
#endif

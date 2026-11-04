#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeTaskRefreshChecks {
    static func run(store: AppStore) async {
        store.taskDrafts = [:]
        let original = NativeReview.task
        var canonical = original.fields; canonical["revision"] = .number(2); canonical["status"] = .string("in-progress"); canonical["body"] = .string("Updated on another device")
        let note: JSONValue = .object(["id": .string("db1e63b6-80e4-448a-a3ec-1cb61a129142"), "body": .string("New remote comment")])
        let latest = JSONValue.object(["task": .object(canonical), "notes": .array([note]), "images": .array([])])
        var checks: [String: Bool] = [:]
        let clean = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in latest }
        await clean.refresh()
        checks["cleanDetailsReceiveRemoteStatusBodyAndComments"] = clean.status == "in-progress" && clean.body == "Updated on another device" && clean.notes.count == 1
        store.taskDrafts = [:]
        let dirty = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in latest }
        dirty.title = "Unsaved local title"; await dirty.refresh()
        checks["remoteChangesNeverReplaceDraftOrAdvanceItsBaseRevision"] = dirty.title == "Unsaved local title" && dirty.task["revision"].number == 1 && dirty.notes.count == 1 && !dirty.message.isEmpty
        store.taskDrafts = [:]
        let mismatch = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in .object(["task": .object(["id": .string("wrong"), "revision": .number(99)])]) }
        await mismatch.refresh()
        checks["mismatchedRefreshCannotReplaceAnotherTask"] = mismatch.task.id == original["id"].text && mismatch.task["revision"].number == 1
        let missing = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in throw APIError(status: 404, message: "Removed task") }
        await missing.refresh()
        checks["remoteDeletionMarksTheDetailUnavailableWithoutInventingAnUndoReceipt"] = missing.unavailable && !missing.deleted
        store.taskDrafts = [:]
        var held: CheckedContinuation<JSONValue, Never>?
        let race = TaskEditor(store: store, detail: .object(["task": original])) { _, method, body in
            if method == "GET" { return await withCheckedContinuation { held = $0 } }
            var row = original.fields; row["revision"] = .number(2)
            for key in ["title", "body", "status", "urgent"] { row[key] = body?[key] ?? .null }
            return .object(["task": .object(row)])
        }
        let late = Task { await race.refresh() }; while held == nil { await Task.yield() }
        race.title = "Locally acknowledged title"; await race.save()
        held?.resume(returning: latest); await late.value
        checks["heldRemoteReadCannotUndoANewerLocalAcknowledgement"] = race.title == "Locally acknowledged title" && race.task["revision"].number == 2
        for draftCase in [false, true] {
            store.taskDrafts = [:]
            var pending: CheckedContinuation<JSONValue, Never>?
            var reads = 0
            var third = canonical; third["revision"] = .number(3); third["body"] = .string("Newest confirmed details")
            let newest: JSONValue = .object(["task": .object(third), "notes": .array([note]), "images": .array([])])
            let editor = TaskEditor(store: store, detail: .object(["task": original])) { _, method, _ in
                if method == "POST" { return await withCheckedContinuation { pending = $0 } }
                reads += 1; return newest
            }
            let operation = Task { await editor.removeNote(APIRecord(raw: note.fields)) }
            while pending == nil { await Task.yield() }
            await editor.refresh()
            checks["commentMutationFencesConcurrentRefresh" + String(draftCase)] = reads == 0
            editor.accept(newest)
            if draftCase { editor.title = "Local draft stays" }
            let receipt: JSONValue = .object(["task": .object(canonical), "notes": .array([]), "images": .array([])])
            pending?.resume(returning: receipt)
            let acknowledged = await operation.value
            checks["oldCommentACKNeverReplacesNewerDetail" + String(draftCase)] = acknowledged && editor.task["revision"].number == 3 && editor.body == "Newest confirmed details" && (!draftCase || editor.title == "Local draft stays")
        }
        store.taskDrafts = [:]
        var noOpWrites = 0
        let noOp = TaskEditor(store: store, detail: .object(["task": original])) { _, method, _ in
            if method == "POST" { noOpWrites += 1 }
            return latest
        }
        let unchangedTitle = noOp.title, unchangedBody = noOp.body, unchangedStatus = noOp.status, unchangedUrgent = noOp.urgent
        noOp.title = unchangedTitle; noOp.body = unchangedBody; noOp.status = unchangedStatus; noOp.urgent = unchangedUrgent
        await noOp.refresh(); await noOp.save()
        checks["bindingInitializationNeverCreatesAnEditOrFalseRemoteConflict"] = noOpWrites == 0 && !noOp.remoteChanged && noOp.message.isEmpty && noOp.status == "in-progress"

        var commentCache = original.fields; commentCache["dirty"] = .bool(false); commentCache["comment"] = .string("Keep my comment")
        store.taskDrafts = [original["id"].text: commentCache]
        let commentOnly = TaskEditor(store: store, detail: latest) { _, _, _ in latest }
        checks["commentOnlyDraftCannotRollBackFreshFieldsOrRevision"] = commentOnly.task["revision"].number == 2 && commentOnly.status == "in-progress" && commentOnly.comment == "Keep my comment"

        var identical = original.fields; identical["revision"] = .number(2)
        var dirtyCache = original.fields; dirtyCache["dirty"] = .bool(true); dirtyCache["comment"] = .string("Keep my comment")
        store.taskDrafts = [original["id"].text: dirtyCache]
        let same = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in .object(["task": .object(identical), "notes": .array([note]), "images": .array([])]) }
        await same.refresh()
        checks["alreadySavedIdenticalDraftClearsConflictWithoutLosingComment"] = !same.remoteChanged && !same.failed && same.message.isEmpty && same.task["revision"].number == 2 && same.comment == "Keep my comment" && store.taskDrafts[same.task.id]?["dirty"]?.flag == false

        store.taskDrafts = [original["id"].text: dirtyCache]
        let sameReceipt = TaskEditor(store: store, detail: .object(["task": original])) { _, _, _ in latest }
        sameReceipt.accept(.object(["task": .object(identical)]))
        checks["identicalMutationReceiptDoesNotClaimAnotherDeviceConflict"] = !sameReceipt.remoteChanged && sameReceipt.task["revision"].number == 2 && sameReceipt.comment == "Keep my comment"
        await store.signOut()
        let report: [String: Any] = ["passed": checks.count == 13 && checks.values.allSatisfy { $0 }, "checks": checks, "scope": "Simulator actual TaskEditor refresh and draft models with injected responses; no real task mutations or two-device UI latency measurement"]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-task-refresh-checks.json"), options: .atomic) }
    }
}
#endif

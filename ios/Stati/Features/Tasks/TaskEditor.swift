import SwiftUI

@MainActor @Observable
final class TaskEditor {
    var task: APIRecord
    var notes: [APIRecord] = []
    var images: [APIRecord] = []
    var message = ""
    var saving = false
    var failed = false
    var comment = ""
    var submittingComment = false
    private var pendingComment: PendingTaskComment?
    var hasPendingComment: Bool { pendingComment != nil }
    private let ownerID: String
    private let ownerEpoch: UUID
    var isCurrentAccount: Bool { active }
    private var active: Bool { store.me?.id == ownerID && store.accountEpoch == ownerEpoch && store.api.signedIn }
    private var debounce: Task<Void, Never>?
    private var changedDuringSave = false
    private let fetch: @MainActor (String, String, JSONValue?) async throws -> JSONValue
    private let store: AppStore
    private var commentID = UUID().uuidString.lowercased()
    var deleted = false
    var unavailable = false
    var remoteChanged = false
    private var refreshGeneration = UUID()
    private var dirty = false
    private var confirmedRevision: Double = 0
    init(store: AppStore, detail: JSONValue, request: (@MainActor (String, String, JSONValue?) async throws -> JSONValue)? = nil) {
        fetch = request ?? { path, method, body in try await store.api.request(path, method: method, body: body) }
        self.store = store; ownerID = store.me?.id ?? ""; ownerEpoch = store.accountEpoch; task = APIRecord(raw: detail["task"].fields); notes = detail["notes"].records; images = detail["images"].records
        confirmedRevision = task["revision"].number
        if let cached = store.taskDrafts[task.id] {
            dirty = cached["dirty"]?.flag == true
            if dirty { for key in ["title", "body", "urgent", "status", "revision"] { if let value = cached[key] { task[key] = value } } }
            comment = cached["comment"]?.text ?? ""; commentID = cached["commentID"]?.text ?? commentID
            if let id = cached["pendingCommentID"]?.text, let body = cached["pendingCommentBody"]?.text { pendingComment = PendingTaskComment(id: id, body: body) }
            reconcileSavedTask(APIRecord(raw: detail["task"].fields))
        }
    }
    private func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue { try await fetch(path, method, body) }
    var title: String { get { task.title } set { guard newValue != title else { return }; task["title"] = .string(newValue); changed() } }
    var body: String { get { task["body"].text } set { guard newValue != body else { return }; task["body"] = .string(newValue); changed() } }
    var status: String { get { task["status"].text } set { guard newValue != status else { return }; task["status"] = .string(newValue); changed() } }
    var urgent: Bool { get { task["urgent"].flag } set { guard newValue != urgent else { return }; task["urgent"] = .bool(newValue); changed() } }
    func cache() { guard active else { return }; var value = task.raw; if let pendingComment { value["pendingCommentID"] = .string(pendingComment.id); value["pendingCommentBody"] = .string(pendingComment.body) }; value["comment"] = .string(comment); value["commentID"] = .string(commentID); value["dirty"] = .bool(dirty); store.taskDrafts[task.id] = value }
    func changed() {
        guard active, !deleted, !unavailable else { return }; refreshGeneration = UUID(); dirty = true; cache()
        if saving { changedDuringSave = true; return }
        debounce?.cancel(); debounce = Task { do { try await Task.sleep(for: .milliseconds(500)); await save() } catch { } }
    }
    func save() async {
        guard active, dirty, task["canManage"].flag, !saving, !deleted, !unavailable, !remoteChanged, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        refreshGeneration = UUID()
        saving = true; failed = false; changedDuringSave = false; let sent = task
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("update"), "id": .string(task.id), "revision": task["revision"], "title": task["title"], "body": task["body"], "status": task["status"], "urgent": task["urgent"]]))
            guard active else { saving = false; return }
            let saved = APIRecord(raw: result["task"].fields)
            guard saved.id == sent.id, saved["revision"].number > sent["revision"].number,
                  ["title", "body", "status", "urgent"].allSatisfy({ saved[$0] == sent[$0] }) else {
                throw APIError(status: 409, message: "The saved task could not be confirmed.")
            }
            guard saved["revision"].number >= confirmedRevision else { saving = false; return }
            confirmedRevision = saved["revision"].number
            store.taskChanged(saved)
            if task == sent { dirty = false; task = saved; if comment.isEmpty && pendingComment == nil { store.taskDrafts.removeValue(forKey: task.id) } else { cache() } }
            else { task["revision"] = saved["revision"]; cache(); changedDuringSave = true }
            message = "Saved"; saving = false
            if changedDuringSave { changed() }
        } catch { saving = false; if active { failed = true; message = error.localizedDescription + " Your draft is kept." } }
    }
    func note() async {
        guard active, !submittingComment, !saving else { return }
        guard let intent = pendingComment ?? PendingTaskComment(id: commentID, body: comment) else {
            message = "Write a comment up to 2,000 characters."; return
        }
        refreshGeneration = UUID()
        pendingComment = intent; cache()
        guard store.draftWarning.isEmpty else { message = store.draftWarning; return }
        submittingComment = true; defer { submittingComment = false }
        if dirty && task["canManage"].flag { await save(); if failed || !active { return } }
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string("note"), "id": .string(task.id), "revision": task["revision"], "noteId": .string(intent.id), "body": .string(intent.body)]))
            guard active else { return }
            guard intent.isAcknowledged(result, taskID: task.id) else { throw APIError(status: 409, message: "The comment was not confirmed. Your saved comment is kept for retry.") }
            accept(result); finishComment(intent)
        } catch {
            guard active else { return }
            if let current = try? await request("/tasks/" + task.id), active, intent.isAcknowledged(current, taskID: task.id) { accept(current); finishComment(intent) }
            else if active { message = error.localizedDescription + " Retry checks the same saved comment."; cache() }
        }
    }
    private func finishComment(_ intent: PendingTaskComment) {
        guard active, pendingComment == intent else { return }
        pendingComment = nil
        if commentID == intent.id { comment = intent.composerAfterAcknowledgement(comment); commentID = UUID().uuidString.lowercased() }
        if !dirty && comment.isEmpty { store.taskDrafts.removeValue(forKey: task.id) } else { cache() }
        message = ""
    }
    func accept(_ value: JSONValue) {
        guard active, value["task"]["id"].text == task.id,
              value["task"]["revision"].number >= max(confirmedRevision, task["revision"].number) else { return }
        confirmedRevision = value["task"]["revision"].number
        refreshGeneration = UUID()
        reconcileSavedTask(APIRecord(raw: value["task"].fields))
        notes = value["notes"].records; images = value["images"].records
        store.taskChanged(APIRecord(raw: value["task"].fields))
    }
    func refresh() async {
        guard active, !saving, !submittingComment, !deleted, !unavailable else { return }
        let scope = UUID(); refreshGeneration = scope
        do {
            let value = try await request("/tasks/" + task.id)
            try Task.checkCancellation(); guard active, refreshGeneration == scope else { return }
            let saved = APIRecord(raw: value["task"].fields)
            guard saved.id == task.id, let revision = Int(exactly: saved["revision"].number), revision >= 1 else { throw APIError(status: 409, message: "This task update could not be verified.") }
            guard saved["revision"].number >= max(confirmedRevision, task["revision"].number) else { return }
            confirmedRevision = saved["revision"].number
            notes = value["notes"].records; images = value["images"].records
            reconcileSavedTask(saved)
        } catch is CancellationError { }
        catch let error as APIError where [401, 403, 404].contains(error.status) {
            guard active, refreshGeneration == scope else { return }; unavailable = true
        } catch { if active && refreshGeneration == scope { message = error.localizedDescription } }
    }
    private func reconcileSavedTask(_ saved: APIRecord) {
        guard saved.id == task.id, saved["revision"].number >= task["revision"].number else { return }
        let sameEdits = title == saved.title && body == saved["body"].text && status == saved["status"].text && urgent == saved["urgent"].flag
        if !dirty || sameEdits {
            task = saved; dirty = false; remoteChanged = false; failed = false; message = ""
            debounce?.cancel()
            if comment.isEmpty && pendingComment == nil { store.taskDrafts.removeValue(forKey: task.id) } else { cache() }
        } else {
            let edits = task.raw; task = saved
            for key in ["title", "body", "urgent", "status", "revision"] { task[key] = edits[key] ?? .null }
            if saved["revision"].number > task["revision"].number {
                remoteChanged = true; failed = true
                message = "This task changed on another device. Your draft is kept; choose the saved version before editing further."
            }
            cache()
        }
    }
    func reloadSavedVersion() async {
        guard active, !saving, !submittingComment, !deleted, !unavailable else { return }
        let scope = UUID(); refreshGeneration = scope; saving = true
        defer { saving = false }
        do {
            let value = try await request("/tasks/" + task.id)
            try Task.checkCancellation(); guard active, refreshGeneration == scope else { return }
            let saved = APIRecord(raw: value["task"].fields)
            guard saved.id == task.id, saved["revision"].number >= task["revision"].number else { throw APIError(status: 409, message: "The saved version could not be verified. Your draft is kept.") }
            confirmedRevision = saved["revision"].number
            task = saved; notes = value["notes"].records; images = value["images"].records
            dirty = false; remoteChanged = false; failed = false; message = ""
            if comment.isEmpty && pendingComment == nil { store.taskDrafts.removeValue(forKey: task.id) } else { cache() }
            store.taskChanged(saved)
        } catch { if active && refreshGeneration == scope { message = error.localizedDescription } }
    }
    func removeNote(_ note: APIRecord, restoring: Bool = false) async -> Bool {
        guard active, !submittingComment, !saving, !deleted, !unavailable else { return false }
        refreshGeneration = UUID()
        submittingComment = true; defer { submittingComment = false }
        if dirty { await save(); if failed || saving || dirty || !active { return false } }
        let sent = task
        do {
            let result = try await request("/tasks", method: "POST", body: .object(["action": .string(restoring ? "restore-note" : "delete-note"), "id": .string(sent.id), "revision": sent["revision"], "noteId": .string(note.id)]))
            guard active else { return false }
            guard result["task"]["id"].text == sent.id,
                  result["task"]["revision"].number > sent["revision"].number,
                  case .array = result["notes"],
                  result["notes"].records.contains(where: { $0.id == note.id }) == restoring else {
                throw APIError(status: 409, message: "The comment change could not be confirmed. Refresh and try again.")
            }
            // A valid receipt can offer Undo without replacing a newer visible snapshot.
            accept(result); return true
        } catch { if active { message = error.localizedDescription }; return false }
    }
}

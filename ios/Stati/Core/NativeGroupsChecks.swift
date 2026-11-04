#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeGroupsChecks {
    static func row(_ n: Int, name: String? = nil, revision: Int = 1) -> JSONValue {
        .object(["id": .string(String(format: "ab1e63b6-80e4-448a-a3ec-%012d", n)), "name": .string(name ?? "Group \(n)"), "ownerId": .string(NativeReview.userID), "revision": .number(Double(revision)), "memberCount": .number(1), "canManage": .bool(true)])
    }
    static func page(_ groups: [JSONValue], cursor: String = "") -> JSONValue {
        .object(["groups": .array(groups), "nextCursor": cursor.isEmpty ? .null : .string(cursor), "canCreate": .bool(true)])
    }
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:]
        var pages = 0
        let full = WorshipGroupsModel(store: store) { path, _, _ in
            pages += 1
            return path.contains("before=") ? page((100..<120).map { row($0) }) : page((0..<100).map { row($0) }, cursor: "older")
        }
        await full.load()
        checks["allAccessibleGroupsDrainEveryPage"] = full.loaded && full.groups.count == 120 && pages == 2
        let broken = WorshipGroupsModel(store: store) { _, _, _ in page([row(1)], cursor: "repeat") }
        await broken.load()
        checks["repeatedPageCannotValidateDefaultsOrKeepPrivateMetadata"] = !broken.loaded && broken.groups.isEmpty && !broken.message.isEmpty
        var held: CheckedContinuation<JSONValue, Never>?
        let probe = NativeWorkspaceProbe()
        let model = WorshipGroupsModel(store: store) { _, method, _ in
            if method == "PATCH" { return .object(["ok": .bool(true), "group": row(1, name: "Updated", revision: 2)]) }
            if probe.block { return await withCheckedContinuation { held = $0 } }
            return page([row(1)])
        }
        await model.load(); probe.block = true
        let stale = Task { await model.load() }
        while held == nil { await Task.yield() }
        var draft = GroupEditDraft(ownerID: NativeReview.userID, id: row(1)["id"].text, revision: 1); draft.name = "Updated"
        do { _ = try await model.save(draft.freeze()) } catch { checks["mutationError"] = false }
        held?.resume(returning: page([row(1)])); await stale.value
        checks["olderListCannotUndoAcknowledgedMemberEdit"] = model.groups.first?.name == "Updated" && model.groups.first?["revision"].number == 2
        let wrong = WorshipGroupsModel(store: store) { _, _, _ in .object(["ok": .bool(true), "group": row(2)]) }
        do { _ = try await wrong.save(draft.freeze()); checks["wrongReceiptCannotPublishAnotherGroup"] = false }
        catch { checks["wrongReceiptCannotPublishAnotherGroup"] = wrong.groups.isEmpty }
        let denied = WorshipGroupsModel(store: store) { path, _, _ in
            if path.hasSuffix("/" + row(1)["id"].text) { throw APIError(status: 404, message: "Removed from group") }
            return page([row(1)])
        }
        await denied.load(); let before = denied.revision
        do { _ = try await denied.detail(row(1)["id"].text) } catch { }
        checks["deniedDetailClearsPrivateMetadataAndPreviewRevision"] = denied.groups.isEmpty && denied.revision > before
        var candidatesPages = 0
        let picker = WorshipGroupsModel(store: store) { _, _, _ in
            candidatesPages += 1
            return .object(["members": .array([.object(["id": row(candidatesPages)["id"], "name": .string("Member \(candidatesPages)")])]), "nextCursor": candidatesPages == 1 ? .string("next") : .null])
        }
        do { checks["memberPickerLoadsBeyondFirstPage"] = try await picker.candidates().count == 2 && candidatesPages == 2 }
        catch { checks["memberPickerLoadsBeyondFirstPage"] = false }
        var oldRead: CheckedContinuation<JSONValue, Never>?
        let signingOut = WorshipGroupsModel(store: store) { _, _, _ in await withCheckedContinuation { oldRead = $0 } }
        let late = Task { await signingOut.load() }
        while oldRead == nil { await Task.yield() }
        await store.signOut()
        oldRead?.resume(returning: page([row(1)])); await late.value
        checks["signoutFencesLatePrivateGroupList"] = signingOut.groups.isEmpty && !signingOut.loaded
        let report: [String: Any] = ["passed": checks.values.allSatisfy { $0 }, "checks": checks, "scope": "Simulator actual observable group models with injected HTTP; no production groups, UI gestures or membership mutations"]
        do {
            let folder = URL.applicationSupportDirectory
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]).write(to: folder.appending(path: "native-groups-checks.json"), options: .atomic)
        } catch { print("Native group report could not be written") }
    }
}
#endif

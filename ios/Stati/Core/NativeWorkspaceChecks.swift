#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeWorkspaceChecks {
    static func run(store: AppStore) async {
        store.taskDrafts = [:] // Each injected scenario starts without another route’s persisted sample draft.
        store.offlineSongs.invalidate(computer: store.selectedComputer) // This route owns its isolated SimulatorReview namespace; repeated runs start from the same empty fixture.
        var checks: [String: Bool] = [:]
        do {
            let original = APIRecord(raw: NativeReview.task.fields)
            var saved = original; saved["status"] = .string("in-progress"); saved["revision"] = .number(2)
            var suspended: CheckedContinuation<JSONValue, Never>?
            let readProbe = NativeWorkspaceProbe()
            var posts = 0
            let model = IPadTasksModel(store: store) { _, method, _ in
                if method == "POST" { posts += 1; return .object(["task": saved.value]) }
                if readProbe.block { return await withCheckedContinuation { suspended = $0 } }
                return .object(["items": .array([original.value]), "total": .number(1)])
            }
            await model.load(); readProbe.block = true
            let stale = Task { await model.load() }
            while suspended == nil { await Task.yield() }
            await model.move(id: original.id, status: "in-progress")
            checks["acknowledgedMoveUpdatesWithoutReload"] = model.tasks.first?["status"].text == "in-progress" && posts == 1
            suspended?.resume(returning: .object(["items": .array([original.value]), "total": .number(1)])); await stale.value
            checks["olderReadCannotUndoAcknowledgedMove"] = model.tasks.first?["status"].text == "in-progress"
            let editor = TaskEditor(store: store, detail: .object(["task": saved.value])) { _, _, body in
                var row = saved; for key in ["title", "body", "status", "urgent"] { row[key] = body?[key] ?? .null }; row["revision"] = .number(3)
                return .object(["task": row.value])
            }
            editor.title = "Changed while inspector is open"; await editor.save()
            checks["editorPublishesConfirmedCanonicalRow"] = store.lastTaskChange?.title == "Changed while inspector is open" && store.lastTaskChange?["revision"].number == 3
            let previous = store.me; store.me = nil
            await model.move(id: original.id, status: "complete"); editor.title = "Wrong owner"; await editor.save()
            checks["signoutFencesBoardAndEditorMutations"] = posts == 1 && store.lastTaskChange?.title == "Changed while inspector is open"
            store.me = previous
            var deleting = original; deleting["deleted"] = .bool(true); deleting["revision"] = .number(2)
            var restored = original; restored["revision"] = .number(3)
            let sharedBoard = IPadTasksModel(store: store) { _, method, body in
                if method == "POST" {
                    return body?["action"].text == "delete" ? deleting.value : .object(["task": restored.value])
                }
                return .object(["items": .array([original.value]), "total": .number(1)])
            }
            await sharedBoard.load(); await sharedBoard.delete(original)
            checks["sharedPhoneTabletDeleteAppliesReceiptAndCount"] = sharedBoard.tasks.isEmpty && sharedBoard.total == 0 && store.taskCount == 0 && store.lastTaskChange?["deleted"].flag == true
            await sharedBoard.undo()
            checks["sharedPhoneTabletUndoAppliesReceiptWithoutRead"] = sharedBoard.tasks.first?["revision"].number == 3 && sharedBoard.total == 1 && store.taskCount == 1 && sharedBoard.removed == nil && store.lastTaskChange?.id == original.id
            var olderRead: CheckedContinuation<JSONValue, Never>?
            let orderProbe = NativeWorkspaceProbe()
            let orderedBoard = IPadTasksModel(store: store) { _, _, _ in
                if !orderProbe.block { orderProbe.block = true; return await withCheckedContinuation { olderRead = $0 } }
                return .object(["items": .array([restored.value]), "total": .number(1)])
            }
            let earlierLoad = Task { await orderedBoard.load() }
            while olderRead == nil { await Task.yield() }
            await orderedBoard.load()
            olderRead?.resume(returning: .object(["items": .array([original.value]), "total": .number(1)])); await earlierLoad.value
            checks["sharedPhoneTabletLatestReadWins"] = orderedBoard.tasks.first?["revision"].number == 3
            var pages: [Int] = []
            let library = SongLibraryModel(store: store) { path in
                let offset = Int(URLComponents(string: path)?.queryItems?.first { $0.name == "offset" }?.value ?? "") ?? 0
                pages.append(offset)
                return .object(["items": .array((offset..<min(103, offset + 50)).map { .object(["id": .string("sample-" + String($0)), "title": .string("Sample song " + String($0))]) }), "total": .number(103), "groups": .array([]), "updatedAt": .number(42)])
            }
            await library.load(computerID: store.selectedComputer, group: "", query: "")
            checks["fullLibraryAutomaticallyDrainsEveryPage"] = pages == [0, 50, 100] && library.items.count == 103 && library.message.isEmpty
            let broken = SongLibraryModel(store: store) { path in
                .object(["items": .array(path.contains("offset=0") ? [original.value] : []), "total": .number(3), "groups": .array([])])
            }
            await broken.load(computerID: store.selectedComputer, group: "", query: "")
            checks["noProgressKeepsEarlierRowsAndReportsIncomplete"] = broken.items.count == 1 && !broken.message.isEmpty && !broken.loading
            var oldPage: CheckedContinuation<JSONValue, Never>?
            let switching = SongLibraryModel(store: store) { path in
                if path.contains("query=old") { return await withCheckedContinuation { oldPage = $0 } }
                return .object(["items": .array([.object(["id": .string("new"), "title": .string("New search")])]), "total": .number(1)])
            }
            let old = Task { await switching.load(computerID: store.selectedComputer, group: "", query: "old") }
            while oldPage == nil { await Task.yield() }
            await switching.load(computerID: store.selectedComputer, group: "", query: "new")
            oldPage?.resume(returning: .object(["items": .array([original.value]), "total": .number(1)])); await old.value
            checks["oldSearchCannotReplaceNewLibrary"] = switching.items.map(\.id) == ["new"]
            var overviewReads: [String] = []
            let overview = IPadLibraryOverview(store: store) { path in
                overviewReads.append(path)
                if path.contains("/songs") { return .object(["items": .array((0..<50).map { .object(["id": .string("catalog-" + String($0)), "groupName": .string("Choir")]) }), "total": .number(1000), "groups": .array([.string("Choir"), .string("Worship")]), "updatedAt": .number(42)]) }
                if path.contains("/services") { return .object(["plans": .array([])]) }
                return .object(["materials": .array([]), "nextCursor": .null])
            }
            await overview.load()
            checks["sidebarGroupMetadataDoesNotRedownloadEntireSongCatalog"] = overview.groupsLoaded && overview.songGroups == ["Choir", "Worship"] && overviewReads.filter { $0.contains("/songs") }.count == 1
            var offlineSong = APIRecord(raw: NativeReview.song.fields)
            offlineSong["groupName"] = .string("Choir")
            try await store.offlineSongs.save([offlineSong], computer: store.selectedComputer, complete: true)
            let offlineLibrary = SongLibraryModel(store: store) { _ in throw URLError(.notConnectedToInternet) }
            await offlineLibrary.load(computerID: store.selectedComputer, group: "Choir", query: "Amazing")
            checks["offlineLibraryReopensCompleteCachedLyricsAndFilters"] = offlineLibrary.items.map(\.id) == [offlineSong.id] && offlineLibrary.items.first?["text"] == offlineSong["text"] && offlineLibrary.message.hasPrefix("Offline")
            let offlineRequest = SongGalleryRequest(computerID: store.selectedComputer, songs: [offlineSong], selectedID: offlineSong.id)!
            let offlineReader = SongGalleryModel(store: store, request: offlineRequest, fetch: { _ in throw URLError(.notConnectedToInternet) })
            await offlineReader.load()
            checks["offlineSongReaderUsesCachedSourceWithoutInventingGroupNotes"] = offlineReader.song?["text"] == offlineSong["text"] && offlineReader.files.isEmpty && offlineReader.message.hasPrefix("Offline")
            if let me = store.me {
                try OfflineIdentityStorage.save(OfflineIdentity(sessionFingerprint: store.api.sessionFingerprint, profile: me, computers: store.computers))
                let cold = AppStore()
                checks["coldOfflineLaunchRestoresOnlyTheExistingSessionOwner"] = cold.me?.id == me.id && cold.selectedComputer == store.selectedComputer && OfflineIdentityStorage.read(fingerprint: "different-session") == nil
                OfflineIdentityStorage.clear()
            }
            let deniedLibrary = SongLibraryModel(store: store) { _ in throw APIError(status: 403, message: "Access removed") }
            await deniedLibrary.load(computerID: store.selectedComputer, group: "", query: "")
            let afterDenial = try store.offlineSongs.rows(computer: store.selectedComputer)
            checks["onlineAccessDenialNeverFallsBackToCachedPrivateSongs"] = deniedLibrary.items.isEmpty && afterDenial.isEmpty
            store.serviceDrafts = [:]
            let oldPlan = APIRecord(raw: NativeReview.plan.fields)
            var newPlan = oldPlan; newPlan["notes"] = .string("Latest service notes"); newPlan["revision"] = .number(oldPlan["revision"].number + 1)
            var serviceReads = 0
            let serviceEditor = ServiceEditor(store: store, computerID: store.selectedComputer, plan: oldPlan) { _ in serviceReads += 1; return .object(["plans": .array([newPlan.value])]) }
            await serviceEditor.refresh()
            checks["cleanOpenServiceReceivesRemoteSavedDetails"] = serviceEditor.notes == "Latest service notes" && serviceReads == 1
            serviceEditor.notes = "Local service draft"; await serviceEditor.refresh()
            checks["remoteServiceRefreshNeverOverwritesAnUnsavedDraft"] = serviceEditor.notes == "Local service draft" && serviceReads == 1 && store.serviceDrafts[oldPlan.id]?["notes"]?.text == "Local service draft"
            store.serviceDrafts = [:]
            let resources = FileResourceCache(); defer { resources.clear() }
            let probe = NativeWorkspaceProbe()
            let bytes = NativeReviewMaterial.pdf
            let fetch: @MainActor @Sendable () async throws -> Data = { probe.downloads += 1; try await Task.sleep(for: .milliseconds(30)); return bytes }
            async let a = resources.bytes(key: "owner|file|v1", filename: "sample.pdf", download: fetch)
            async let b = resources.bytes(key: "owner|file|v1", filename: "sample.pdf", download: fetch)
            let first = try await a, second = try await b
            _ = try await resources.bytes(key: "owner|file|v1", filename: "sample.pdf", download: fetch)
            checks["previewAndOpenCoalesceAndReuseProtectedBytes"] = probe.downloads == 1 && first == bytes && second == bytes
            _ = try await resources.bytes(key: "owner|file|v2", filename: "sample.pdf", download: fetch)
            checks["replacementVersionGetsFreshBytes"] = probe.downloads == 2
            resources.clear(); _ = try await resources.bytes(key: "other-owner|file|v1", filename: "sample.pdf", download: fetch)
            checks["accountResetCannotReusePrivatePreview"] = probe.downloads == 3
        } catch { checks["unexpectedError"] = false }
        let report: [String: Any] = ["checks": checks, "passed": checks.count == 20 && checks.values.allSatisfy { $0 }, "scope": "Simulator actual observable models, injected HTTP responses and protected cache I/O; no UI gestures or production mutations"]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-workspace-checks.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif

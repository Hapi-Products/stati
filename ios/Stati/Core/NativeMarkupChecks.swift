#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeMarkupChecks {
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:], created: [URL] = []
        NativeMarkupServer.content = NativeReviewMaterial.pdf; NativeMarkupServer.receipts = [:]; NativeMarkupServer.putCount = 0
        defer { for file in created { try? FileManager.default.removeItem(at: file) } }
        do {
            guard let item = FilePreviewItem(record: APIRecord(raw: NativeReviewMaterial.file.fields), pathKey: "fileUrl") else { return }
            let original = NativeReviewMaterial.pdf
            let temporary = try NativePreview.stage(data: original, filename: "Choir.pdf"); defer { NativePreview.remove(temporary) }
            let editor = FileMarkupController(store: store)
            await editor.inspect(item)
            checks["verifiedOriginalOpensNativeEditorCopy"] = await editor.open(item: item, url: temporary)
            guard let first = editor.intent else { throw FileMarkupStorage.failure("No fixture edit") }
            created.append(try FileMarkupStorage.folder(first))
            let edited = try NativePreview.stage(data: NativeScanChecks.pdf, filename: "Choir.pdf"); defer { NativePreview.remove(edited) }
            editor.saved(edited)
            guard let staged = editor.intent else { throw FileMarkupStorage.failure("No saved fixture edit") }
            let stagedBytes = try Data(contentsOf: FileMarkupStorage.verifiedFile(staged))
            checks["nativeSaveStagesExactBytesWithoutUploading"] = NativeMarkupServer.putCount == 0 && stagedBytes == NativeScanChecks.pdf
            NativeMarkupServer.loseNextReply = true
            await editor.editorClosed()
            let afterLoss = try FileMarkupStorage.latest(ownerID: NativeReview.userID, path: item.path)
            checks["lostReplyRetainsImmutableIntentAfterReopen"] = afterLoss?.id == staged.id && afterLoss?.sha256 == staged.sha256 && afterLoss?.state == .unconfirmed
            await editor.sync()
            let synced = try FileMarkupStorage.latest(ownerID: NativeReview.userID, path: item.path)
            checks["reconciliationDoesNotUploadADuplicate"] = NativeMarkupServer.putCount == 1 && synced?.state == .synced
            checks["syncedDeviceCopyAndSourceRemainExact"] = (try Data(contentsOf: temporary)) == original && synced.flatMap { try? Data(contentsOf: FileMarkupStorage.verifiedFile($0)) } == NativeScanChecks.pdf
            editor.saved(temporary) // A later native callback gets a separate intent, preserving the accepted version.
            guard let next = editor.intent else { throw FileMarkupStorage.failure("No later fixture edit") }
            created.append(try FileMarkupStorage.folder(next))
            let retained = try FileMarkupStorage.verifiedFile(staged)
            checks["lateNativeSaveCannotRewriteAnAcceptedIntent"] = next.id != staged.id && next.baseSHA256 == staged.sha256 && retained.lastPathComponent == staged.contentFile
            await editor.sync()
            checks["followupUsesPriorSavedHash"] = NativeMarkupServer.putCount == 2 && editor.intent?.state == .synced && NativeMarkupServer.content == original
            let sharedBeforeSwitch = NativeMarkupServer.content
            editor.saved(edited)
            guard let kept = editor.intent else { throw FileMarkupStorage.failure("No local fixture edit") }
            created.append(try FileMarkupStorage.folder(kept))
            editor.useCurrentVersion()
            let keptBytes = try Data(contentsOf: FileMarkupStorage.verifiedFile(kept))
            checks["switchingToSharedVersionKeepsLocalMarkup"] = editor.intent?.state == .keptOnDevice && keptBytes == NativeScanChecks.pdf && NativeMarkupServer.content == sharedBeforeSwitch
            let metadata = try FileMarkupStorage.folder(kept).appending(path: "edit.json")
            let savedMetadata = try Data(contentsOf: metadata)
            try Data("{broken".utf8).write(to: metadata, options: [.atomic])
            do { _ = try FileMarkupStorage.latest(ownerID: NativeReview.userID, path: item.path); checks["corruptJournalKeepsEditedBytes"] = false }
            catch { checks["corruptJournalKeepsEditedBytes"] = (try Data(contentsOf: FileMarkupStorage.verifiedFile(kept))) == keptBytes }
            try savedMetadata.write(to: metadata, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let previousIntent = editor.intent, previousUser = store.me; store.me = nil
            editor.saved(edited)
            checks["signedOutViewerCannotStageAnotherAccountEdit"] = editor.intent == previousIntent
            store.me = previousUser
            let direct = FileMarkupController(store: store)
            await direct.inspect(item)
            let before = try FileMarkupStorage.latest(ownerID: NativeReview.userID, path: item.path)
            let ready = direct.prepare(item: item, url: temporary)
            let afterPrepare = try FileMarkupStorage.latest(ownerID: NativeReview.userID, path: item.path)
            checks["soleViewerPreparesWithoutCreatingUnusedJournal"] = ready && afterPrepare?.id == before?.id
            direct.saved(edited)
            if let staged = direct.intent { created.append(try FileMarkupStorage.folder(staged)) }
            checks["soleViewerStagesNativeCopyBeforeUpload"] = direct.needsSync && NativeMarkupServer.putCount == 2
            await direct.editorClosed()
            checks["soleViewerCloseSavesOriginalAndDevice"] = direct.intent?.state == .synced && NativeMarkupServer.content == NativeScanChecks.pdf && direct.savedFile != nil
        } catch { checks["noUnexpectedError"] = false }
        let report: [String: Any] = ["passed": checks.count == 13 && checks.values.allSatisfy { $0 }, "checks": checks, "putCount": NativeMarkupServer.putCount, "scope": "Simulator real Markup controller and protected-file I/O with injected receipts; no drawing gestures, camera, production reads or mutations"]
        let file = URL.applicationSupportDirectory.appending(path: "native-markup-checks.json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif

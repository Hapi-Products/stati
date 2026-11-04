#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeSongCorrectionChecks {
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:]
        let root = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let song = APIRecord(raw: NativeReview.song.fields), computer = NativeReview.computerID
        func receipt(_ payload: JSONValue) -> JSONValue { var value = payload.fields; value["computerId"] = .string(computer); value["status"] = .string("new"); return .object(["correction": .object(value)]) }
        do {
            var posts = 0, saved: JSONValue?
            let path = root.appending(path: "lost-ack")
            let first = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, method, body in
                if method == "GET" { if let saved { return saved }; throw APIError(status: 404, message: "Not submitted") }
                posts += 1; saved = receipt(body!); throw URLError(.networkConnectionLost)
            }, storageRoot: path)
            first.comment = "Please check the spelling"; await first.send(); let id = first.draft.id, payload = first.draft.payload
            first.comment = "A late composer cannot alter the frozen request"
            checks["lostAcknowledgementKeepsFrozenIdentityAndPayload"] = posts == 1 && first.draft.phase == .unconfirmed && first.draft.payload == payload
            let reopened = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, method, _ in if method == "POST" { posts += 1 }; return saved! }, storageRoot: path)
            await reopened.send()
            checks["restartReconcilesReceiptWithoutSecondSubmission"] = posts == 1 && reopened.draft.id == id && reopened.draft.phase == .sent
            var forbiddenPosts = 0
            let lookupFailure = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, method, _ in if method == "POST" { forbiddenPosts += 1 }; throw URLError(.cannotConnectToHost) }, storageRoot: root.appending(path: "lookup"))
            lookupFailure.comment = "Keep this comment"; await lookupFailure.send()
            checks["unknownReceiptLookupNeverPostsOrRotatesIdentity"] = forbiddenPosts == 0 && lookupFailure.draft.phase == .unconfirmed && !lookupFailure.message.isEmpty
            let wrong = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, _, _ in var value = payload.fields; value["computerId"] = .string(UUID().uuidString); return .object(["correction": .object(value)]) }, storageRoot: root.appending(path: "wrong"))
            wrong.comment = "Wrong receipt must remain unconfirmed"; await wrong.send()
            checks["foreignReceiptCannotPublishConfirmation"] = wrong.draft.phase == .unconfirmed && !wrong.message.isEmpty
            var held: CheckedContinuation<JSONValue, any Error>?, ownerPosts = 0
            let ownerFence = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, method, _ in if method == "POST" { ownerPosts += 1; return .null }; return try await withCheckedThrowingContinuation { held = $0 } }, storageRoot: root.appending(path: "owner"))
            ownerFence.comment = "Old account draft"; let operation = Task { await ownerFence.send() }; while held == nil { await Task.yield() }
            let person = store.me; store.me = nil; held?.resume(throwing: APIError(status: 404, message: "No receipt")); await operation.value; store.me = person
            checks["ownerChangeDuringLookupCannotSendOldDraft"] = ownerPosts == 0
            let imageRoot = root.appending(path: "images"), storage = try SongCorrectionStorage(ownerID: store.me!.id, computerID: computer, songID: song.id, root: imageRoot)
            var imageDraft = SongCorrectionDraft(ownerID: store.me!.id, computerID: computer, song: song); imageDraft.message = "Image correction"; let image = try storage.stage(Data([1,2,3])); imageDraft.images = [image]; try storage.save(imageDraft)
            var imagePuts = 0, didUpload = false
            let originalImage: JSONValue = .object(["id": .string(image.id), "filename": .string("edited.jpg"), "bytes": .number(99), "sha256": .string(String(repeating: "e", count: 64)), "uploadFilename": .string(image.filename), "uploadBytes": .number(Double(image.bytes)), "uploadSha256": .string(image.sha256)])
            let imageModel = SongCorrectionModel(store: store, computerID: computer, song: song, request: { route, method, body in
                if route.hasSuffix("/images") { return .object(["images": .array(didUpload ? [originalImage] : [])]) }
                if method == "GET" { throw APIError(status: 404, message: "No receipt") }; return receipt(body!)
            }, upload: { _, _, _ in imagePuts += 1; didUpload = true; throw URLError(.networkConnectionLost) }, storageRoot: imageRoot)
            await imageModel.send()
            checks["imageLostAcknowledgementUsesImmutableUploadReceiptAfterMarkup"] = imagePuts == 1 && imageModel.draft.phase == .sent && imageModel.draft.confirmedImages == [image.id]
            let malformed = root.appending(path: "corrupt"), file = malformed.appending(path: store.me!.id + "/" + computer + "/" + song.id + "/draft.json")
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true); let broken = Data("unreadable saved bytes".utf8); try broken.write(to: file)
            var corruptRequests = 0
            let corrupt = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, _, _ in corruptRequests += 1; return .null }, storageRoot: malformed)
            await corrupt.send()
            let preserved = try Data(contentsOf: file)
            checks["unreadableJournalKeepsOriginalBytesAndBlocksNetwork"] = !corrupt.readable && corruptRequests == 0 && preserved == broken
            let multiple = SongCorrectionModel(store: store, computerID: computer, song: song, request: { _, _, _ in .null }, storageRoot: root.appending(path: "multiple"))
            let source = song["text"].text as NSString
            let firstRange = NSRange(location: 0, length: min(7, source.length))
            let secondRange = NSRange(location: source.length - 5, length: 5)
            multiple.selectPassage(firstRange); multiple.selectPassage(secondRange)
            checks["separateSelectionsCreateSeparateCorrections"] = multiple.draft.edits.count == 2
            let firstID = multiple.draft.edits.first!.id
            multiple.replacePassage(firstID, with: "Edited first passage")
            multiple.selectPassage(NSRange(location: 0, length: 9), editing: firstID)
            checks["changingEarlierSelectionKeepsBothIndependentCorrections"] = multiple.draft.edits.count == 2 && multiple.draft.edits.first?.replacement == "Edited first passage" && multiple.draft.edits.last?.range == secondRange
            let lyricsView = SongCorrectionLyrics.makeTextView(text: song["text"].text)
            let width: CGFloat = 320
            let before = lyricsView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            lyricsView.selectedRange = firstRange
            let after = lyricsView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            checks["lyricsSelectionKeepsFullHeightWithoutNestedScrolling"] = !lyricsView.isScrollEnabled && before == after
            let unchanged = imageModel.draft.song["text"] == song["text"] && reopened.draft.song["text"] == song["text"]
            checks["correctionsNeverMutateTheOriginalLyrics"] = unchanged
        } catch { checks["unexpectedFailure"] = false }
        let report: [String: Any] = ["checks": checks, "passed": checks.count == 11 && checks.values.allSatisfy { $0 }, "scope": "Simulator native correction model with injected receipts and protected local I/O; no production submission or photo gesture"]
        if let bytes = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys,.prettyPrinted]) { try? bytes.write(to: URL.applicationSupportDirectory.appending(path: "native-correction-checks.json"), options: .atomic) }
    }
}
#endif

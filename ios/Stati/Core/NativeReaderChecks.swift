#if DEBUG && targetEnvironment(simulator)
import UIKit

@MainActor enum NativeReaderChecks {
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:]
        let anchor = UIBarButtonItem(systemItem: .action)
        let activity = UIActivityViewController(activityItems: [NativeReviewMaterial.pdf], applicationActivities: nil)
        activity.modalPresentationStyle = .popover
        activity.popoverPresentationController?.sourceItem = anchor
        SharePopoverPlacement.configure(activity, traits: UITraitCollection(traitsFrom: [.init(userInterfaceIdiom: .pad), .init(horizontalSizeClass: .regular)]))
        checks["ipadShareKeepsActualButtonAnchorAndOpensBelow"] = activity.popoverPresentationController?.sourceItem === anchor && activity.popoverPresentationController?.permittedArrowDirections == .up
        let phone = UIActivityViewController(activityItems: ["Sample"], applicationActivities: nil)
        phone.modalPresentationStyle = .popover; phone.popoverPresentationController?.sourceItem = anchor
        let before = phone.popoverPresentationController?.permittedArrowDirections
        SharePopoverPlacement.configure(phone, traits: UITraitCollection(traitsFrom: [.init(userInterfaceIdiom: .phone), .init(horizontalSizeClass: .compact)]))
        checks["phoneShareRetainsNativeAdaptivePlacement"] = phone.popoverPresentationController?.permittedArrowDirections == before
        checks["commonClickerKeysHaveOneBoundedDirection"] = [UIKeyCommand.inputRightArrow, UIKeyCommand.inputPageDown, " "].allSatisfy { ReaderKeyBindings.step(for: $0) == 1 } && [UIKeyCommand.inputLeftArrow, UIKeyCommand.inputPageUp, "\u{8}"].allSatisfy { ReaderKeyBindings.step(for: $0) == -1 } && ReaderKeyBindings.step(for: "x") == nil
        let a = NativeReview.songID, b = String(repeating: "b", count: 64)
        let request = SongGalleryRequest(computerID: NativeReview.computerID, items: [SongGalleryItem(id: a, songID: a, title: "First song"), SongGalleryItem(id: b, songID: b, title: "Second song")], selectedID: a)!
        let c = String(repeating: "c", count: 64)
        let serviceRequest = SongGalleryRequest(computerID: NativeReview.computerID, items: request.items + [SongGalleryItem(id: c, songID: c, title: "Third song")], selectedID: a, service: true)!
        checks["serviceNavigationIsExplicitAndBrowseStaysOrdinary"] = serviceRequest.isService && !request.isService
        let serviceReader = SongGalleryModel(store: store, request: serviceRequest)
        serviceReader.selectServiceSong(c)
        checks["runningOrderCanJumpToAnySong"] = serviceReader.selected.songID == c
        serviceReader.selectServiceSong("not-an-appearance")
        let ordinaryReader = SongGalleryModel(store: store, request: request)
        ordinaryReader.selectServiceSong(b)
        checks["unknownServiceSongAndOrdinaryBrowseCannotJump"] = serviceReader.selected.songID == c && ordinaryReader.selected.songID == a
        func notes(_ id: String, files: [JSONValue] = []) -> JSONValue { .object(["materials": .array(files), "nextCursor": .null, "linkContext": .object(["computerId": .string(NativeReview.computerID), "songId": .string(id)])]) }
        let lyrics = SongGalleryModel(store: store, request: request, fetch: { path in
            if path.hasPrefix("/group-materials") { return notes(a) }
            return .object(["id": .string(a), "title": .string("First song"), "text": .string("Full lyrics")])
        })
        await lyrics.load()
        checks["noNotesOpensFullLyrics"] = lyrics.song?["text"].text == "Full lyrics" && lyrics.fileRequest == nil && lyrics.message.isEmpty
        let linked = SongGalleryModel(store: store, request: request, fetch: { path in path.hasPrefix("/group-materials") ? notes(a, files: [NativeReviewMaterial.file]) : .object(["id": .string(a), "title": .string("Song")]) })
        await linked.load()
        checks["authorizedNotesStayAvailableWithoutReplacingChosenSongView"] = linked.fileRequest == nil && linked.files.count == 1 && linked.files.first?["fileUrl"].text == NativeReviewMaterial.file["fileUrl"].text
        let unrelated = SongGalleryModel(store: store, request: request, fetch: { path in path.hasPrefix("/group-materials") ? notes(b, files: [NativeReviewMaterial.file]) : .object(["id": .string(a), "title": .string("Song"), "text": .string("Lyrics kept")]) })
        await unrelated.load()
        checks["unconfirmedNotesNeverReplaceLyrics"] = unrelated.fileRequest == nil && unrelated.song?["text"].text == "Lyrics kept" && !unrelated.message.isEmpty
        let deniedNotes = SongGalleryModel(store: store, request: request, fetch: { path in
            if path.contains("before=") { throw APIError(status: 403, message: "Group access removed") }
            if path.hasPrefix("/group-materials") { var page = notes(a, files: [NativeReviewMaterial.file]).fields; page["nextCursor"] = .string("next-page"); return .object(page) }
            return .object(["id": .string(a), "title": .string("Song"), "text": .string("Lyrics remain available")])
        })
        await deniedNotes.load()
        checks["deniedLaterNotesPageNeverPublishesPrivateTitles"] = deniedNotes.files.isEmpty && deniedNotes.fileRequest == nil && deniedNotes.song?["text"].text == "Lyrics remain available"
        var suspended: CheckedContinuation<JSONValue, Never>?
        let racing = SongGalleryModel(store: store, request: request, fetch: { path in
            if path.contains("/songs/" + a) { return await withCheckedContinuation { suspended = $0 } }
            if path.hasPrefix("/group-materials") { return notes(b) }
            return .object(["id": .string(b), "title": .string("Second song")])
        })
        let old = Task { await racing.load() }; while suspended == nil { await Task.yield() }
        racing.move(by: 1); await racing.load()
        suspended?.resume(returning: .object(["id": .string(a), "title": .string("Old song")])); await old.value
        checks["latePriorSongCannotReplaceSelectedSong"] = racing.position.selectedID == b && racing.song?.id == b
        var receiptMatches = false
        let unlink = SongGalleryModel(store: store, request: request, mutate: { _, _ in .object(["ok": .bool(true), "linked": .bool(false), "materialId": .string(receiptMatches ? NativeReviewMaterial.file["id"].text : "wrong"), "computerId": .string(NativeReview.computerID), "songId": .string(a)]) }) { path in path.hasPrefix("/group-materials") ? notes(a, files: [NativeReviewMaterial.file]) : .object(["id": .string(a), "title": .string("Song")]) }
        await unlink.load()
        if let file = unlink.files.first {
            do { try await unlink.unlink(file); checks["foreignUnlinkReceiptKeepsLinkedFile"] = false } catch { checks["foreignUnlinkReceiptKeepsLinkedFile"] = unlink.files.count == 1 }
            receiptMatches = true
            do { try await unlink.unlink(file); checks["confirmedUnlinkUpdatesNotesWithoutReload"] = unlink.files.isEmpty } catch { checks["confirmedUnlinkUpdatesNotesWithoutReload"] = false }
        }
        let longLines = (1...6).map { "Long sample lyric line \($0) with Romanian diacritics ăâîșț" }
        let area = CGSize(width: 320, height: 280)
        let fitted = SongSlidePage.fittedPoints(lines: longLines, preferred: 128, available: area)
        let fittedFont = UIFont.systemFont(ofSize: fitted, weight: .medium)
        checks["largeSlideTextFitsAllOriginalLinesWithoutWrapping"] = longLines.allSatisfy { ($0 as NSString).size(withAttributes: [.font: fittedFont]).width <= area.width + 0.1 } && fittedFont.lineHeight * CGFloat(longLines.count) <= area.height + 0.1
        checks["amenSharesLastLyricSlide"] = SongPages(text: "One\n\nFinal lyric").slides == ["One", "Final lyric\nAmen"]
        let prior = store.me; store.me = nil
        await racing.load()
        checks["signedOutReaderClearsPrivateContent"] = racing.song == nil && racing.fileRequest == nil
        store.me = prior
        let report: [String: Any] = ["checks": checks, "passed": checks.count == 16 && checks.values.allSatisfy { $0 }, "scope": "Actual UIKit popover policy and injected song models. No system Share tap, AirDrop, hardware key event or physical clicker verified."]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-reader-checks.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif

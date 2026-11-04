#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeSongCommandChecks {
    static func run() async {
        let owner = UUID().uuidString.lowercased(), otherOwner = UUID().uuidString.lowercased()
        let computer = UUID().uuidString.lowercased(), songID = String(repeating: "a", count: 64), hash = String(repeating: "b", count: 64)
        let song = APIRecord(raw: ["id": .string(songID), "contentHash": .string(hash)])
        let server = NativeSongCommandServer(songID: songID)
        let fetch: @MainActor (String, String, JSONValue?) async throws -> JSONValue = { path, method, body in try server.fetch(path, method: method, body: body) }
        var checks: [String: Bool] = [:], failure = ""
        do {
            let first = SongCommands(localCheckRequest: fetch); first.load(ownerID: owner)
            await first.start(computerID: computer, song: song, kind: .clone, groupName: "  Ｃｈｏｉｒ  ")
            guard let original = first.requests.first else { throw APIError(status: 0, message: "Original request not saved") }
            let savedOriginal = try SongCommandStorage.load(ownerID: owner)
            checks["lostAcknowledgementKeepsOriginalIDAndPayload"] = original.status == .unconfirmed && server.posts.count == 1 && original.groupName == "Choir" && savedOriginal == first.requests
            let reopened = SongCommands(localCheckRequest: fetch); reopened.load(ownerID: owner)
            server.postFailure = ""
            await reopened.check(original.id, resendIfAbsent: true)
            await reopened.check(original.id, resendIfAbsent: true)
            await reopened.start(computerID: computer, song: song, kind: .clone, groupName: "Other")
            checks["reopenReconcilesWithoutSecondPostOrNewAction"] = server.posts.count == 1 && reopened.requests.first?.id == original.id && reopened.requests.first?.status == .pending
            reopened.dismiss(original.id)
            checks["acceptedRequestCannotBeDismissed"] = reopened.requests.count == 1
            var applied = server.receipts[original.id]!.fields; applied["status"] = .string("applied"); server.receipts[original.id] = .object(applied)
            await reopened.check(original.id); reopened.dismiss(original.id)
            let afterDismiss = try SongCommandStorage.load(ownerID: owner)
            checks["confirmedTerminalResultCanBeDismissed"] = reopened.requests.isEmpty && afterDismiss.isEmpty

            server.postFailure = "before"
            await reopened.start(computerID: computer, song: song, kind: .archive)
            let retryID = reopened.requests[0].id, retryBody = server.posts.last!
            server.getFailure = true
            await reopened.check(retryID, resendIfAbsent: true)
            checks["lookupFailureNeverPosts"] = server.posts.count == 2
            server.getFailure = false; server.postFailure = ""
            let restored = SongCommands(localCheckRequest: fetch); restored.load(ownerID: owner)
            await restored.check(retryID, resendIfAbsent: true)
            checks["confirmedAbsenceRetriesIdenticalSavedRequest"] = server.posts.count == 3 && server.posts.last == retryBody && restored.requests[0].id == retryID && restored.requests[0].status == .pending
            server.mismatch = true
            await restored.check(retryID)
            checks["mismatchedReceiptCannotChangeSavedRequest"] = restored.requests[0].status == .pending && !restored.errors.isEmpty && server.posts.count == 3
            server.mismatch = false
            server.onLookup = { restored.reset(); restored.load(ownerID: otherOwner) }
            await restored.check(retryID)
            checks["accountChangeFencesOldResponse"] = restored.requests.isEmpty && restored.errors.isEmpty && server.posts.count == 3
            server.onLookup = nil
            var archiveResult = server.receipts[retryID]!.fields; archiveResult["status"] = .string("applied"); server.receipts[retryID] = .object(archiveResult)
            let resultReader = SongCommands(localCheckRequest: fetch); resultReader.load(ownerID: owner); await resultReader.check(retryID)
            let restartedResult = SongCommands(localCheckRequest: fetch); restartedResult.load(ownerID: owner)
            let recoveredArchive = restartedResult.requests.first
            restartedResult.dismiss(retryID)
            checks["restartedArchiveResultReadableAndDismissibleWithoutLyrics"] = recoveredArchive?.kind == .archive && recoveredArchive?.isTerminal == true && restartedResult.requests.isEmpty && server.posts.count == 3

            let file = try SongCommandStorage.file(ownerID: otherOwner), bad = Data("[broken local fixture".utf8)
            try bad.write(to: file)
            let corrupt = SongCommands(localCheckRequest: fetch); corrupt.load(ownerID: otherOwner)
            await corrupt.start(computerID: computer, song: song, kind: .archive)
            let preserved = try Data(contentsOf: file)
            checks["unreadableJournalKeepsBytesAndBlocksNetwork"] = corrupt.needsRecovery && server.posts.count == 3 && preserved == bad
            try JSONEncoder().encode([original]).write(to: file)
            corrupt.retryReading()
            checks["wrongOwnerJournalRemainsBlocked"] = corrupt.needsRecovery && server.posts.count == 3
            for id in [owner, otherOwner] { try FileManager.default.removeItem(at: SongCommandStorage.file(ownerID: id).deletingLastPathComponent()) }
        } catch { failure = error.localizedDescription }
        let report: JSONValue = .object(["checks": .object(checks.mapValues { .bool($0) }), "error": .string(failure), "passed": .bool(failure.isEmpty && checks.count == 11 && checks.values.allSatisfy { $0 }), "scope": .string("iOS simulator protected local I/O and injected request responses only; no network or PC actions")])
        try? JSONEncoder().encode(report).write(to: URL.applicationSupportDirectory.appending(path: "native-song-command-checks.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
#endif

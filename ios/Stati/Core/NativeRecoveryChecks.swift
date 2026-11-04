#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeRecoveryChecks {
    static func run(api: APIClient) async {
        let owner = UUID().uuidString.lowercased(), device = UUID().uuidString.lowercased()
        let source = URL.temporaryDirectory.appending(path: "stati-local-check-" + UUID().uuidString, directoryHint: .isDirectory)
        let report = URL.applicationSupportDirectory.appending(path: "native-recovery-checks.json")
        var results: [String: Bool] = [:], failure = ""
        do {
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
            let first = source.appending(path: "First.txt"), second = source.appending(path: "Second.txt")
            try Data("First local fixture".utf8).write(to: first); try Data("Second local fixture".utf8).write(to: second)
            let queue = UploadQueue(api: api); queue.load(userID: owner)
            do { try await FileStager.stage(count: 2, queue: queue) { index in
                if index == 1 { throw APIError(status: 0, message: "Injected second-file failure") }
                return try await UploadFiles.prepare(url: first, userID: owner, deviceID: device)
            } } catch { }
            let directory = try UploadFiles.directory(userID: owner)
            let partialCopies = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "upload" }
            results["failedBatchLeavesNoPartialCopiesOrIntents"] = queue.jobs.isEmpty && partialCopies.isEmpty
            try await FileStager.stage(count: 2, queue: queue) { index in try await UploadFiles.prepare(url: index == 0 ? first : second, userID: owner, deviceID: device) }
            let acceptedID = queue.jobs[0].id, acceptedFile = queue.jobs[0].localFile, deliveredFile = queue.jobs[1].localFile
            for index in queue.jobs.indices {
                let job = queue.jobs[index]
                queue.jobs[index].receipt = ["protocol": .string("stati-upload-v1"), "accepted": .bool(true), "id": .string(UUID().uuidString), "intentId": .string(job.id), "deviceId": .string(job.deviceID), "filename": .string(job.filename), "bytes": .number(Double(job.bytes)), "sha256": .string(job.sha256), "status": .string(index == 0 ? "queued" : "delivered")]
            }
            try queue.save(); queue.clearFinished()
            results["clearRetainsAcceptedPendingFileAndIntent"] = queue.jobs.count == 1 && queue.jobs[0].id == acceptedID && FileManager.default.fileExists(atPath: acceptedFile.path)
            results["clearRemovesOnlyFinishedLocalCopy"] = !FileManager.default.fileExists(atPath: deliveredFile.path)
            let restored = UploadQueue(api: api); restored.load(userID: owner)
            results["restartRetainsPendingIDReceiptAndChecksum"] = restored.jobs == queue.jobs && restored.jobs[0].receipt?["status"] == .string("queued")
            var oldContainerJobs = queue.jobs
            for index in oldContainerJobs.indices {
                oldContainerJobs[index].localFile = URL(fileURLWithPath: "/old-install/Library/Application Support/Uploads/" + owner + "/" + oldContainerJobs[index].id + ".upload")
            }
            try JSONEncoder().encode(oldContainerJobs).write(to: directory.appending(path: "queue.json"))
            let relocated = UploadQueue(api: api); relocated.load(userID: owner)
            results["appContainerMoveRecoversPendingIDReceiptAndCurrentFile"] = !relocated.needsRecovery && relocated.jobs == queue.jobs && FileManager.default.fileExists(atPath: relocated.jobs.first?.localFile.path ?? "")
            try relocated.save()
            let migrated = try Data(contentsOf: directory.appending(path: "queue.json"))
            results["migrationPreservesOriginalLedgerAndWritesRelativeIdentity"] = FileManager.default.fileExists(atPath: directory.appending(path: "queue-before-relative-paths.json").path) && !String(decoding: migrated, as: UTF8.self).contains("old-install")
            results["sourceFilesRemainUnchanged"] = try Data(contentsOf: first) == Data("First local fixture".utf8) && Data(contentsOf: second) == Data("Second local fixture".utf8)
            let corruptOwner = UUID().uuidString.lowercased(), badBytes = Data("[broken send list".utf8)
            let corruptDirectory = try UploadFiles.directory(userID: corruptOwner), corruptFile = corruptDirectory.appending(path: "queue.json")
            try badBytes.write(to: corruptFile)
            let unreadable = UploadQueue(api: api); unreadable.load(userID: corruptOwner)
            do { try unreadable.save() } catch { }
            let preserved = try Data(contentsOf: corruptFile)
            results["unreadableLedgerBlocksWritesAndPreservesOriginal"] = unreadable.needsRecovery && unreadable.availableSlots == 0 && preserved == badBytes
            try FileManager.default.removeItem(at: corruptDirectory)
            try FileManager.default.removeItem(at: directory)
            try FileManager.default.removeItem(at: source)
        } catch { failure = error.localizedDescription }
        let payload: JSONValue = .object(["checks": .object(results.mapValues { .bool($0) }), "error": .string(failure), "passed": .bool(failure.isEmpty && results.count == 8 && results.values.allSatisfy { $0 }), "scope": .string("Simulator local file I/O only; no upload or production mutation")])
        try? JSONEncoder().encode(payload).write(to: report, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
#endif

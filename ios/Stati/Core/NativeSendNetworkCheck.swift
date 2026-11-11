#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeSendNetworkCheck {
    static let route = "send-network-check"
    static var accepted: JSONValue?
    static var posts = 0
    static var lookups = 0
    static var job: UploadJob?

    static func response(_ request: URLRequest) -> (status: Int, body: JSONValue)? {
        guard NativeReview.route == route, let path = request.url?.path, let job else { return nil }
        if path == "/api/uploads/" + job.id {
            lookups += 1
            return accepted.map { (200, $0) } ?? (404, .object([:]))
        }
        if path == "/api/connections/device:" + job.deviceID { return (200, .object([:])) }
        if path == "/api/receive/device:" + job.deviceID {
            return (200, .object(["connection": .object(["status": .string("approved")]), "uploadProtocol": .string("stati-upload-v1"), "sendingAllowed": .bool(true)]))
        }
        return nil
    }

    static func losesUploadResponse(_ request: URLRequest) -> Bool {
        guard NativeReview.route == route, let job, request.httpMethod == "POST",
              request.url?.path == "/api/receive/device:" + job.deviceID + "/uploads/" + job.id else { return false }
        posts += 1
        accepted = .object(["protocol": .string("stati-upload-v1"), "accepted": .bool(true),
                            "intentId": .string(job.id), "deviceId": .string(job.deviceID), "id": .string(UUID().uuidString),
                            "filename": .string(job.filename), "bytes": .number(Double(job.bytes)), "sha256": .string(job.sha256), "status": .string("queued")])
        return true
    }

    static func run(api: APIClient) async {
        var checks: [String: Bool] = [:]
        let owner = UUID().uuidString.lowercased()
        let source = URL.temporaryDirectory.appending(path: UUID().uuidString + ".txt")
        defer { try? FileManager.default.removeItem(at: source) }
        do {
            try Data("Cântă cu bucurie.".utf8).write(to: source)
            var staged = try await UploadFiles.prepare(url: source, userID: owner, deviceID: NativeReview.computerID)
            staged.isSongSubmission = true
            job = staged
            let queue = UploadQueue(api: api)
            queue.load(userID: owner)
            try queue.append([staged])
            queue.send()
            for _ in 0..<160 where queue.busy { try await Task.sleep(for: .milliseconds(50)) }
            checks["lostResponseRecoveredWithoutSecondUpload"] = posts == 1 && lookups == 2 && queue.jobs.first?.verifiedStatus == "queued"
            let now = Date.now
            queue.keepSongCopy(staged.id, keep: true, now: now)
            checks["temporaryCopyUsesOriginalStagedBytes"] = queue.jobs.first?.hasSavedSong(at: now) == true && FileManager.default.fileExists(atPath: staged.localFile.path)
            if var receipt = accepted?.fields { receipt["status"] = .string("delivered"); accepted = .object(receipt) }
            await queue.refreshReceipts()
            queue.clearFinished()
            let restored = UploadQueue(api: api)
            restored.load(userID: owner)
            checks["savedReceiptKeepsSongAcrossRestartAndClear"] = restored.jobs.first?.hasSavedSong(at: now.addingTimeInterval(172_800)) == true && FileManager.default.fileExists(atPath: staged.localFile.path)
        } catch { checks["fixtureCompleted"] = false }
        let report: [String: Any] = ["checks": checks, "passed": checks.count == 3 && checks.values.allSatisfy { $0 }]
        if let bytes = try? JSONSerialization.data(withJSONObject: report) {
            try? bytes.write(to: URL.applicationSupportDirectory.appending(path: "native-send-network-checks.json"), options: .atomic)
        }
    }
}
#endif

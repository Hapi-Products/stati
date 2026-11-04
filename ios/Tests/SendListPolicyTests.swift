import Testing
import Foundation
@testable import StatiCore

struct SendListPolicyTests {
    private let userID = "eb1e63b6-80e4-448a-a3ec-1cb61a129142"
    private func job(_ status: String? = nil) -> UploadJob {
        var job = UploadJob(id: UUID().uuidString.lowercased(), userID: userID, deviceID: "3ba6dd35-835d-48d7-bfd1-0753c596d8b3", filename: "Song.txt", localFile: URL(filePath: "/tmp/test.upload"), bytes: 25, sha256: String(repeating: "a", count: 64))
        if let status { job.receipt = ["protocol": .string("stati-upload-v1"), "accepted": .bool(true), "id": .string(UUID().uuidString), "intentId": .string(job.id), "deviceId": .string(job.deviceID), "filename": .string(job.filename), "bytes": .number(25), "sha256": .string(job.sha256), "status": .string(status)] }
        return job
    }
    @Test func acceptedQueuedCopyCannotBeClearedAsFinished() {
        #expect(!job().isFinished)
        #expect(!job("queued").isFinished)
        #expect(SendListPolicy.availableSlots((0..<20).map { _ in job("queued") }) == 0)
    }
    @Test func onlyMatchingTerminalReceiptsReleaseCapacity() {
        for status in ["delivered", "rejected", "expired"] { #expect(job(status).isFinished) }
        var corrupt = job("delivered"); corrupt.receipt?["sha256"] = .string("wrong")
        #expect(!corrupt.isFinished)
        corrupt = job("delivered"); corrupt.receipt?["accepted"] = .number(1)
        #expect(!corrupt.isFinished)
        #expect(!job("unknown").isFinished)
    }
    @Test func fullBatchRejectedBeforePartialAppend() {
        let existing = (0..<19).map { _ in job("queued") }
        #expect(!SendListPolicy.canAppend([job(), job()], to: existing, userID: userID))
        #expect(SendListPolicy.canAppend([job()], to: existing, userID: userID))
        #expect(SendListPolicy.canAppend((0..<20).map { _ in job() }, to: [job("delivered")], userID: userID))
    }
    @Test func batchesCannotCrossAccountsOrRepeatAnIntent() {
        let first = job(); var foreign = job(); foreign.userID = UUID().uuidString
        #expect(!SendListPolicy.canAppend([first, foreign], to: [], userID: userID))
        #expect(!SendListPolicy.canAppend([first, first], to: [], userID: userID))
        #expect(!SendListPolicy.canAppend([first], to: [first], userID: userID))
        #expect(!SendListPolicy.canAppend([], to: [], userID: userID))
        #expect(!SendListPolicy.canAppend([first], to: [], userID: ""))
    }
}

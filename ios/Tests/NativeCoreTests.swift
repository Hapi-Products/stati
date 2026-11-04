import Testing
import Foundation
@testable import StatiCore

struct NativeCoreTests {
    private var job: UploadJob { UploadJob(id: "eb1e63b6-80e4-448a-a3ec-1cb61a129142", userID: UUID().uuidString, deviceID: "3ba6dd35-835d-48d7-bfd1-0753c596d8b3", filename: "Harul Tău.pptx", localFile: URL(filePath: "/tmp/test.upload"), bytes: 245, sha256: String(repeating: "a", count: 64)) }
    private func receipt(_ job: UploadJob) -> JSONValue { .object(["protocol": .string("stati-upload-v1"), "accepted": .bool(true), "intentId": .string(job.id), "deviceId": .string(job.deviceID), "filename": .string(job.filename), "bytes": .number(Double(job.bytes)), "sha256": .string(job.sha256), "id": .string(UUID().uuidString), "status": .string("queued")]) }
    @Test func confirmedReceiptMatchesEveryIdentity() {
        let job = job
        #expect(ReceiptValidator.matches(receipt(job), job: job))
        for key in ["intentId", "deviceId", "filename", "sha256", "id", "protocol", "status"] {
            var wrong = receipt(job).fields; wrong[key] = .string("wrong")
            #expect(!ReceiptValidator.matches(.object(wrong), job: job))
        }
    }
    @Test func incompleteOrRoundedReceiptCannotConfirmDelivery() {
        let job = job
        var wrong = receipt(job).fields; wrong["bytes"] = .number(245.5)
        #expect(!ReceiptValidator.matches(.object(wrong), job: job))
        wrong = receipt(job).fields; wrong["accepted"] = .number(1)
        #expect(!ReceiptValidator.matches(.object(wrong), job: job))
        wrong = receipt(job).fields; wrong["accepted"] = .bool(false)
        #expect(!ReceiptValidator.matches(.object(wrong), job: job))
        #expect(!ReceiptValidator.matches(.object([:]), job: job))
    }
    @Test func durableJobRetainsIntentAndReceipt() throws {
        var job = job; job.receipt = receipt(job).fields
        let restored = try JSONDecoder().decode(UploadJob.self, from: JSONEncoder().encode(job))
        #expect(restored == job)
        #expect(restored.status != "Delivered")
    }
    @Test func serverAcknowledgementIsDifferentFromComputerDelivery() {
        var job = job; job.receipt = receipt(job).fields
        #expect(job.status.lowercased().contains("waiting"))
        job.receipt?["status"] = .string("delivered")
        #expect(job.status == "Saved on the computer")
    }
    @Test func serviceRoundTripPreservesUnknownFields() throws {
        let bytes = Data(#"{"id":"service","title":"Duminică","revision":12,"futureMetadata":{"checklist":[true,null,7]},"songs":[{"id":"appearance-1","songId":"song"},{"id":"appearance-2","songId":"song"}]}"#.utf8)
        var record = APIRecord(raw: try JSONDecoder().decode(JSONValue.self, from: bytes).fields)
        record["title"] = .string("Sunday")
        let restored = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(record.value))
        #expect(restored["futureMetadata"]["checklist"].items == [.bool(true), .null, .number(7)])
        #expect(restored["songs"].items.count == 2)
        #expect(restored["revision"].number == 12)
    }
    @Test func scheduleUsesWallClockWithoutUTCDateShift() {
        let date = ServiceSchedule.read(date: "2026-11-01", time: "18:30")
        #expect(ServiceSchedule.date(date) == "2026-11-01")
        #expect(ServiceSchedule.time(date) == "18:30")
    }
    @Test func wireFilenamesMatchWindowsAndPreserveDiacritics() {
        #expect(TransferFilename.safe("folder/CON.txt") == "presentation-CON.txt")
        #expect(TransferFilename.safe("Harul Tău: final?.pptx ") == "Harul Tău_ final_.pptx")
        #expect(TransferFilename.safe("ＡＢＣ.txt") == "ABC.txt")
        #expect(TransferFilename.safe("../") == "presentation-")
        #expect(TransferFilename.safe(String(repeating: "a", count: 139) + "😀.txt").utf16.count == 139)
    }

    @Test func previousDraftFormatRemainsReadable() throws {
        let saved = Data(#"{"tasks":{"task":{"revision":7,"comment":"Keep me"}},"services":{"service":{"notes":"Choir first"}}}"#.utf8)
        let value = try JSONDecoder().decode(DraftSnapshot.self, from: saved)
        #expect(value.send == SendDraft())
        #expect(value.tasks["task"]?["comment"] == .string("Keep me"))
        #expect(value.services["service"]?["notes"] == .string("Choir first"))
    }
    @Test func textSendDraftRoundTripsWithDiacritics() throws {
        let value = DraftSnapshot(send: SendDraft(title: "Cântare", text: "Harul Tău\nRămâne mereu"))
        let restored = try JSONDecoder().decode(DraftSnapshot.self, from: JSONEncoder().encode(value))
        #expect(restored.send == value.send)
    }

}

import Foundation

nonisolated enum ReceiptValidator {
    static func matches(_ value: JSONValue, job: UploadJob) -> Bool {
        value["protocol"].text == "stati-upload-v1" && value["accepted"] == .bool(true) && value["intentId"].text == job.id && value["deviceId"].text == job.deviceID && value["filename"].text == job.filename && value["bytes"].number == Double(job.bytes) && value["sha256"].text == job.sha256 && UUID(uuidString: value["id"].text) != nil && ["queued", "delivered", "rejected", "expired"].contains(value["status"].text)
    }
}

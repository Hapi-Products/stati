import Foundation

nonisolated struct UploadJob: Identifiable, Codable, Sendable, Equatable {
    var id: String
    var userID: String
    var deviceID: String
    var filename: String
    var localFile: URL
    var bytes: Int
    var sha256: String
    var receipt: [String: JSONValue]?
    var message: String?
    var isFinished: Bool {
        guard let receipt, ReceiptValidator.matches(.object(receipt), job: self) else { return false }
        return ["delivered", "rejected", "expired"].contains(receipt["status"]?.text ?? "")
    }
    var status: String {
        guard let receipt else { return message ?? "Ready to send" }
        switch receipt["status"]?.text {
        case "delivered": return "Saved on the computer"
        case "rejected": return "Rejected · " + (receipt["rejectionReason"]?.text ?? "Ask the operator")
        case "expired": return "Delivery expired · check with the operator"
        default: return "Sent · waiting for the computer"
        }
    }
}

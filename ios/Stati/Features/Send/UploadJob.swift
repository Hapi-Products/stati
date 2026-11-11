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
    var isSongSubmission: Bool? = nil
    var keepSongUntil: Date? = nil
    var skippedSongCopy: Bool? = nil

    var verifiedStatus: String? {
        guard let receipt, ReceiptValidator.matches(.object(receipt), job: self) else { return nil }
        return receipt["status"]?.text
    }

    var offersSongCopy: Bool {
        isSongSubmission == true && keepSongUntil == nil && skippedSongCopy != true
            && ["queued", "delivered"].contains(verifiedStatus ?? "")
    }

    func hasSavedSong(at date: Date) -> Bool {
        guard let keepSongUntil, verifiedStatus != nil else { return false }
        return verifiedStatus == "delivered" || date < keepSongUntil
    }

    func shouldRemoveExpiredSong(at date: Date) -> Bool {
        guard let keepSongUntil else { return false }
        return date >= keepSongUntil && ["rejected", "expired"].contains(verifiedStatus ?? "")
    }
    var isFinished: Bool {
        ["delivered", "rejected", "expired"].contains(verifiedStatus ?? "")
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

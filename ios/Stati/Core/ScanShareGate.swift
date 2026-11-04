import Foundation

nonisolated struct ScanShareGate: Sendable {
    private(set) var reviewedScanID: String?
    private(set) var attempted = false
    mutating func finishReview(scanID: String) { reviewedScanID = scanID }
    func canShare(scanID: String?, uncertain: Bool) -> Bool {
        !attempted && !uncertain && (scanID == nil || scanID == reviewedScanID)
    }
    mutating func beginShare(scanID: String?, uncertain: Bool) -> Bool {
        guard canShare(scanID: scanID, uncertain: uncertain) else { return false }
        attempted = true
        return true
    }
    mutating func allowCorrection() { attempted = false }
}

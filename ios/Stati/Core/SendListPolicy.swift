import Foundation

nonisolated enum SendListPolicy {
    static let maximumActive = 20
    static func availableSlots(_ jobs: [UploadJob]) -> Int { max(0, maximumActive - jobs.filter { !$0.isFinished }.count) }
    static func canAppend(_ additions: [UploadJob], to jobs: [UploadJob], userID: String) -> Bool {
        guard !additions.isEmpty, UUID(uuidString: userID) != nil, additions.count <= availableSlots(jobs) else { return false }
        let existingIDs = Set(jobs.map(\.id))
        return additions.allSatisfy { $0.userID == userID && $0.receipt == nil && !existingIDs.contains($0.id) }
            && Set(additions.map(\.id)).count == additions.count
    }
}

import Foundation

@MainActor enum FileStager {
    static func stage(count: Int, queue: UploadQueue, prepare: (Int) async throws -> UploadJob) async throws {
        guard count > 0, count <= queue.availableSlots else { throw APIError(status: 409, message: "You can add \(queue.availableSlots) more files. Wait for the computer to finish the current sends.") }
        var prepared: [UploadJob] = []
        do {
            for index in 0..<count { try Task.checkCancellation(); prepared.append(try await prepare(index)) }
            try Task.checkCancellation()
            try queue.append(prepared)
        } catch {
            for job in prepared { try? FileManager.default.removeItem(at: job.localFile) }
            throw error
        }
    }
}

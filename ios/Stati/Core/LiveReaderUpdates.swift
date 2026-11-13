import Foundation

/// Wake the foreground reader as soon as a change arrives. Retain a timeout for older servers and lost connections.
@MainActor final class LiveReaderUpdates {
    private(set) var revision = 0
    private var sleepers: [UUID: Task<Void, Error>] = [:]

    func signal() {
        revision += 1
        for sleeper in sleepers.values { sleeper.cancel() }
    }

    func wait(after observed: Int, timeout: Duration) async throws {
        try Task.checkCancellation()
        guard revision == observed else { return }
        let id = UUID()
        let sleeper = Task { try await Task.sleep(for: timeout) }
        sleepers[id] = sleeper
        defer { sleepers.removeValue(forKey: id) }
        try await withTaskCancellationHandler {
            // Both the notification and caller cancellation wake the same sleeper.
            _ = await sleeper.result
            try Task.checkCancellation()
        } onCancel: {
            sleeper.cancel()
        }
    }
}

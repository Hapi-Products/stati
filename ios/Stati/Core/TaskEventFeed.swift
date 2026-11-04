import Foundation

@MainActor final class TaskEventFeed {
    private let api: APIClient
    init(api: APIClient) { self.api = api }
    func run(isCurrent: @escaping @MainActor () -> Bool, invalidate: @escaping @MainActor (String) -> Void, connected: @escaping @MainActor (Bool) -> Void = { _ in }) async {
        defer { connected(false) }
        var attempts = 0
        while !Task.isCancelled && isCurrent() {
            let socket = api.taskEventSocket(); socket.maximumMessageSize = 1024; socket.resume()
            do {
                try await withTaskCancellationHandler {
                    while !Task.isCancelled && isCurrent() {
                        let message = try await socket.receive(), data: Data
                        switch message { case .string(let string): data = Data(string.utf8); case .data(let bytes): data = bytes; @unknown default: continue }
                        guard data.count <= 1024, isCurrent(), !Task.isCancelled else { break }
                        let value = try JSONDecoder().decode(JSONValue.self, from: data)
                        if ["tasks-ready", "tasks-changed", "catalog-changed", "services-changed", "groups-changed", "files-changed", "account-changed"].contains(value["type"].text) { connected(true); attempts = 0; invalidate(value["type"].text) }
                    }
                } onCancel: { socket.cancel(with: .goingAway, reason: nil) }
            } catch { if Task.isCancelled || !isCurrent() { socket.cancel(with: .goingAway, reason: nil); return } }
            socket.cancel(with: .goingAway, reason: nil); connected(false)
            guard !Task.isCancelled && isCurrent() else { return }
            invalidate("tasks-ready") // Fallback authenticated read also detects expired sessions.
            attempts = min(5, attempts + 1)
            do { try await Task.sleep(for: .seconds(min(30, Double(1 << attempts)))) } catch { return }
        }
    }
}

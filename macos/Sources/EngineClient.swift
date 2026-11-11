import Foundation
import Darwin

actor EngineClient {
    private let helperURL: URL?
    init(helperURL: URL? = nil) { self.helperURL = helperURL }
    private var process: Process?
    private var connectionID: UUID?
    private var startupOnly = true
    private var input: FileHandle?
    private var output: FileHandle?
    private var reader: Task<Void, Never>?
    private var buffer = Data()
    private var pending: [String: CheckedContinuation<JSONValue, any Error>] = [:]
    private var deadlines: [String: Task<Void, Never>] = [:]
    private var stopped = false
    private var shuttingDown = false
    private var eventContinuation: AsyncStream<String>.Continuation?
    func events() -> AsyncStream<String> { AsyncStream { eventContinuation = $0 } }
    private let maximumBytes = 2 * 1024 * 1024

    func start() throws {
        guard process == nil, !stopped else { return }
        let helper = helperURL ?? Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/Stati Engine.app")
        guard let bundle = Bundle(url: helper), let executable = bundle.executableURL else {
            throw EngineFailure(message: "The bundled Stați engine is missing. Reinstall this native preview.")
        }
        let child = Process(), stdinPipe = Pipe(), stdoutPipe = Pipe()
        let connectionID = UUID()
        child.executableURL = executable
        child.arguments = ["--stati-native-helper"]
        child.standardInput = stdinPipe
        child.standardOutput = stdoutPipe
        // Helper diagnostics never enter the app log or contain response payloads.
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] _ in
            Task { await self?.disconnected(connectionID, "The Stați engine stopped. Choose Retry to reconnect.") }
        }
        do { try child.run() } catch {
            throw EngineFailure(message: "The Stați engine could not start: \(error.localizedDescription)")
        }
        process = child; self.connectionID = connectionID; startupOnly = true
        input = stdinPipe.fileHandleForWriting; output = stdoutPipe.fileHandleForReading
        let descriptor = stdoutPipe.fileHandleForReading.fileDescriptor
        reader = Task.detached { [weak self] in
            var chunk = [UInt8](repeating: 0, count: 64 * 1024)
            while !Task.isCancelled {
                let count = Darwin.read(descriptor, &chunk, chunk.count)
                if count < 0, errno == EINTR { continue }
                if count < 0 {
                    await self?.disconnected(connectionID, "The Stați engine connection closed. Choose Retry to reconnect.")
                    return
                }
                await self?.receive(Data(chunk.prefix(count)), from: connectionID)
                if count == 0 { return }
            }
        }
    }

    func prepareRetry() async throws {
        guard !shuttingDown else { throw EngineFailure(message: "Stați is closing.") }
        guard stopped else { return }
        if let child = process {
            await waitForExit(child, checks: 20)
            guard !shuttingDown else { throw EngineFailure(message: "Stați is closing.") }
            if child.isRunning && startupOnly {
                forceExit(child)
                await waitForExit(child, checks: 10)
            }
            guard !shuttingDown else { throw EngineFailure(message: "Stați is closing.") }
            guard process === child else { return }
            guard !child.isRunning else {
                throw EngineFailure(message: "The Stați engine is still closing. Wait a moment and choose Retry.")
            }
        }
        process = nil
        stopped = false
    }

    func call(_ method: String, args: [JSONValue] = []) async throws -> JSONValue {
        if Task.isCancelled { throw CancellationError() }
        guard !stopped, !shuttingDown else { throw EngineFailure(message: "The Stați engine is disconnected. Choose Retry to reconnect.") }
        try start()
        guard pending.count < 64 else { throw EngineFailure(message: "Too many pending operations. Wait and try again.") }
        let id = UUID().uuidString
        let request = JSONValue.object(["id": .string(id), "method": .string(method), "args": .array(args)])
        var data = try JSONEncoder().encode(request)
        guard data.count <= maximumBytes else { throw EngineFailure(message: "This request is too large for the native preview.") }
        data.append(10)
        if method != "access-status" { startupOnly = false }
        let timeout: UInt64
        switch method {
        case "access-status": timeout = 10
        case "presentation-export", "presentation-insert", "lyrics-export", "deliver", "song-library-rescan", "service-offline-prepare":
            timeout = 180
        default: timeout = 40
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                pending[id] = continuation
                deadlines[id] = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(timeout)) } catch { return }
                    await self?.expire(id, startingUp: method == "access-status")
                }
                do { try input?.write(contentsOf: data) } catch { failed("The Stați engine connection closed.") }
            }
        } onCancel: { Task { await self.cancel(id) } }
    }

    private func disconnected(_ connectionID: UUID, _ message: String) {
        guard self.connectionID == connectionID else { return }
        failed(message)
    }

    private func receive(_ bytes: Data, from connectionID: UUID) {
        guard self.connectionID == connectionID else { return }
        guard !bytes.isEmpty else { failed("The Stați engine connection closed."); return }
        buffer.append(bytes)
        guard buffer.count <= maximumBytes else { failed("The engine response exceeded the native preview limit."); return }
        while let newline = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
            let prefix = Data("STATI_NATIVE:".utf8)
            guard line.starts(with: prefix) else { continue }
            do {
                let reply = try JSONDecoder().decode(JSONValue.self, from: line.dropFirst(prefix.count))
                if !reply["event"].string.isEmpty { eventContinuation?.yield(reply["event"].string); continue }
                let id = reply["id"].string
                guard let continuation = pending.removeValue(forKey: id) else { continue }
                deadlines.removeValue(forKey: id)?.cancel()
                if !reply["error"]["message"].string.isEmpty { continuation.resume(throwing: EngineFailure(message: reply["error"]["message"].string)) }
                else { continuation.resume(returning: reply["result"]) }
            } catch { failed("The engine returned an invalid response."); return }
        }
    }
    private func expire(_ id: String, startingUp: Bool) {
        deadlines.removeValue(forKey: id)
        guard pending[id] != nil else { return }
        if startingUp {
            failed("The Stați engine did not answer. Choose Retry to reconnect.")
        } else {
            pending.removeValue(forKey: id)?.resume(throwing: EngineFailure(message: "The operation timed out. Refresh to check its result before trying again."))
        }
    }
    private func cancel(_ id: String) { deadlines.removeValue(forKey: id)?.cancel(); pending.removeValue(forKey: id)?.resume(throwing: CancellationError()) }
    private func failed(_ message: String) {
        connectionID = nil
        if !stopped && !shuttingDown { eventContinuation?.yield("engine-stopped") }
        stopped = true
        for task in deadlines.values { task.cancel() }; deadlines.removeAll()
        let calls = pending; pending.removeAll()
        for continuation in calls.values { continuation.resume(throwing: EngineFailure(message: message)) }
        reader?.cancel(); reader = nil
        if process?.isRunning == true { process?.terminate() }
        try? input?.close(); try? output?.close(); input = nil; output = nil; buffer.removeAll()
    }
    func stop() async {
        guard !shuttingDown else { return }
        shuttingDown = true
        // EOF asks the owned helper to drain work and close its receiver before exit.
        try? input?.close(); input = nil
        if let child = process {
            await waitForExit(child, checks: 50)
            if child.isRunning && startupOnly {
                forceExit(child)
                await waitForExit(child, checks: 10)
            }
        }
        failed("Stați is closing.")
        eventContinuation?.finish()
    }

    private func waitForExit(_ child: Process, checks: Int) async {
        for _ in 0..<checks {
            guard child.isRunning else { return }
            do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
        }
    }

    private func forceExit(_ child: Process) {
        // Only the helper started by this client can still own its instance lock.
        guard process === child, child.isRunning else { return }
        _ = Darwin.kill(child.processIdentifier, SIGKILL)
    }
}

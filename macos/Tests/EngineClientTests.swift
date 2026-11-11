import Foundation
import Darwin

enum TestFailure: Error { case failed(String) }

@main struct EngineClientTests {
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stati-native-transport-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("Engine.app")
        let executable = helper.appendingPathComponent("Contents/MacOS/TestEngine")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        try """
        <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.hapiproducts.stati.transport-test</string><key>CFBundleExecutable</key><string>TestEngine</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>
        """.write(to: helper.appendingPathComponent("Contents/Info.plist"), atomically: true, encoding: .utf8)
        try """
        #!/usr/bin/env python3
        import sys, json, os, signal, time
        assert sys.argv[1:] == ['--stati-native-helper']
        for line in sys.stdin:
            request = json.loads(line)
            method = request['method']
            if method == 'hang': continue
            if method == 'crash': os._exit(1)
            if method == 'access-status' and request['args'] == ['stuck-shutdown']:
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                print('STATI_NATIVE:' + json.dumps({'id':request['id'], 'result':os.getpid()}), flush=True)
                while True: time.sleep(1)
            if method == 'oversized':
                print('STATI_NATIVE:' + 'x' * (2 * 1024 * 1024 + 100), flush=True)
                continue
            if method == 'invalid':
                print('STATI_NATIVE:{bad json}', flush=True)
                continue
            if method == 'event': print('STATI_NATIVE:' + json.dumps({'event':'workspace-reset'}), flush=True)
            if method == 'failure': response = {'id':request['id'], 'error':{'message':'Permission denied'}}
            else: response = {'id':request['id'], 'result':request['args']}
            print('diagnostic without response prefix', flush=True)
            print('STATI_NATIVE:' + json.dumps(response, ensure_ascii=False), flush=True)
        """.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        var checks = 0
        let client = EngineClient(helperURL: helper)
        let echo = try await client.call("echo", args: [.string("Stați 🎵"), .object(["ok": .bool(true)])])
        guard echo == .array([.string("Stați 🎵"), .object(["ok": .bool(true)])]) else { throw EngineFailure(message: "Unicode/request round-trip failed") }; checks += 1
        do { _ = try await client.call("failure"); throw TestFailure.failed("Expected helper error") } catch let error as EngineFailure { guard error.message == "Permission denied" else { throw error } }; checks += 1
        let events = await client.events()
        let event = Task { var iterator = events.makeAsyncIterator(); return await iterator.next() }
        _ = try await client.call("event")
        guard await event.value == "workspace-reset" else { throw EngineFailure(message: "Workspace reset event missing") }; checks += 1
        let canceled = Task { try await client.call("hang") }
        _ = try await client.call("echo")
        canceled.cancel()
        do { _ = try await canceled.value; throw TestFailure.failed("Expected cancellation") } catch is CancellationError {} ; checks += 1
        let pending = Task { try await client.call("hang") }
        _ = try await client.call("echo")
        do { _ = try await client.call("crash"); throw TestFailure.failed("Expected process failure") } catch is EngineFailure {} ; checks += 1
        do { _ = try await pending.value; throw TestFailure.failed("Expected pending-call failure") } catch is EngineFailure {} ; checks += 1
        try await client.prepareRetry()
        let restarted = try await client.call("echo", args: [.string("reconnected")])
        guard restarted == .array([.string("reconnected")]) else { throw TestFailure.failed("Explicit Retry did not reconnect") }; checks += 1
        await client.stop()
        for method in ["oversized", "invalid"] {
            let broken = EngineClient(helperURL: helper)
            do { _ = try await broken.call(method); throw TestFailure.failed("Expected rejection") } catch is EngineFailure {} ; checks += 1
            await broken.stop()
        }
        let stuck = EngineClient(helperURL: helper)
        let stuckPID = pid_t(try await stuck.call("access-status", args: [.string("stuck-shutdown")]).number)
        guard stuckPID > 0 else { throw TestFailure.failed("The stuck fixture did not report its PID") }
        await stuck.stop()
        guard Darwin.kill(stuckPID, 0) == -1, errno == ESRCH else {
            _ = Darwin.kill(stuckPID, SIGKILL)
            throw TestFailure.failed("An unresponsive helper survived shutdown")
        }; checks += 1
        let stopped = EngineClient(helperURL: helper)
        await stopped.stop()
        do { _ = try await stopped.call("echo"); throw TestFailure.failed("Expected stopped-client rejection") } catch is EngineFailure {} ; checks += 1
        print("Native transport: \(checks) checks passed (Unicode, errors, reset, cancellation, process failure, pending rejection, reconnect, bounded response, invalid JSON, bounded shutdown).")
    }
}

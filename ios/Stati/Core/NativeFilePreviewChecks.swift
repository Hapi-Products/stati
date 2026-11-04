#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeFilePreviewChecks {
    static func run() async {
        let api = APIClient()
        let record = APIRecord(raw: NativeReviewTaskImage.record.fields)
        var checks: [String: Bool] = [:]
        guard let item = FilePreviewItem(record: record, pathKey: "url") else { return }
        let session = FilePreviewSession()
        await session.load(item, api: api) { true }
        let url = session.url
        checks["authenticatedImageDecodedAndOriginalPreserved"] = session.image != nil && url.flatMap { try? Data(contentsOf: $0) } == NativeReviewTaskImage.png
        session.close()
        checks["closeRemovesOnlyViewerTemporaryCopy"] = url != nil && !FileManager.default.fileExists(atPath: url!.path) && session.url == nil && session.image == nil
        let obsolete = FilePreviewSession()
        let operation = Task { await obsolete.load(item, api: api) { true } }
        while !obsolete.loading && !operation.isCancelled { await Task.yield() }
        obsolete.close()
        await operation.value
        checks["closedSessionRejectsLateDownload"] = obsolete.url == nil && obsolete.image == nil && !obsolete.loading
        var active = true
        let switched = FilePreviewSession()
        let accountOperation = Task { await switched.load(item, api: api) { active } }
        while !switched.loading { await Task.yield() }
        active = false
        await accountOperation.value
        checks["accountChangeRejectsLateDownload"] = switched.url == nil && switched.image == nil
        let report: [String: Any] = ["checks": checks, "passed": checks.count == 4 && checks.values.allSatisfy { $0 }, "scope": "Simulator real preview-session model and protected temporary-file I/O using labelled fixture bytes; no UI gestures or production reads"]
        let target = URL.applicationSupportDirectory.appending(path: "native-file-preview-checks.json")
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif

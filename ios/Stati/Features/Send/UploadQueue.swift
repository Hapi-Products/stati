import Foundation
import Observation

@MainActor @Observable
final class UploadQueue {
    let api: APIClient
    var jobs: [UploadJob] = []
    var busy = false
    var message = ""
    var currentName = ""
    private var userID = ""
    private var operation: Task<Void, Never>?
    private var generation = 0
    private var ledgerReadable = true
    var needsRecovery: Bool { !ledgerReadable }
    init(api: APIClient) { self.api = api }
    private var ledger: URL { get throws { try UploadFiles.directory(userID: userID).appending(path: "queue.json") } }
    func load(userID: String) {
        guard self.userID != userID else { return }
        generation += 1; operation?.cancel(); operation = nil; busy = false; self.userID = userID; jobs = []; message = ""
        ledgerReadable = true
        do {
            let url = try ledger
            do {
                let data = try Data(contentsOf: url)
                if data.first(where: { ![9, 10, 13, 32].contains($0) }) == 91 {
                    let backup = url.deletingLastPathComponent().appending(path: "queue-before-relative-paths.json")
                    if !FileManager.default.fileExists(atPath: backup.path) { try FileManager.default.copyItem(at: url, to: backup) }
                }
                let directory = try UploadFiles.directory(userID: userID).standardizedFileURL
                let restored = try UploadLedger.decode(data, ownerID: userID, directory: directory)
                jobs = restored
            } catch let error as CocoaError where error.code == .fileReadNoSuchFile { }
        } catch { ledgerReadable = false; message = "Your saved send list could not be opened. Retry reading it before starting another send. Existing files have been kept." }
    }
    func save() throws {
        guard ledgerReadable else { throw APIError(status: 0, message: "Read the existing send list before saving another send.") }
        try UploadLedger.encode(jobs).write(to: ledger, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func retryReading() { guard !busy, !userID.isEmpty else { return }; let owner = userID; userID = ""; load(userID: owner) }
    func reset() { generation += 1; operation?.cancel(); operation = nil; busy = false; jobs = []; userID = ""; ledgerReadable = true; message = "" }
    var availableSlots: Int { ledgerReadable ? SendListPolicy.availableSlots(jobs) : 0 }
    func append(_ additions: [UploadJob]) throws {
        guard ledgerReadable else { throw APIError(status: 0, message: "Retry reading your existing send list first.") }
        guard SendListPolicy.canAppend(additions, to: jobs, userID: userID) else { throw APIError(status: 409, message: "Finish the current send list first. You can have up to 20 files waiting for the computer.") }
        let previous = jobs
        jobs.append(contentsOf: additions)
        do { try save() } catch { jobs = previous; throw error }
    }
    func cancel() { operation?.cancel() }
    func send(only jobID: String? = nil) {
        guard ledgerReadable, !busy, !jobs.isEmpty else { return }
        busy = true; message = ""; let scope = generation
        operation = Task {
            defer { if scope == generation { busy = false; currentName = ""; operation = nil } }
            for job in jobs where job.receipt == nil && (jobID == nil || job.id == jobID) {
                guard scope == generation else { return }
                do {
                    try Task.checkCancellation(); currentName = job.filename
                    var receipt: JSONValue?
                    do { receipt = try await api.request("/uploads/" + job.id + "?deviceId=" + job.deviceID) }
                    catch let error as APIError where error.status == 404 { receipt = nil }
                    if receipt == nil {
                        _ = try await api.request("/connections/device:" + job.deviceID, method: "POST", body: .object([:]))
                        let access = try await api.request("/receive/device:" + job.deviceID)
                        guard access["connection"]["status"].text == "approved", access["uploadProtocol"].text == "stati-upload-v1", access["sendingAllowed"].flag else { throw APIError(status: 403, message: "Wait for computer access or the service sending window before sending.") }
                        let bytes = try await api.upload("/receive/device:" + job.deviceID + "/uploads/" + job.id, file: job.localFile, headers: ["X-Filename": job.filename.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "file", "X-Checksum-SHA256": job.sha256, "Content-Type": "application/octet-stream", "Content-Length": String(job.bytes)])
                        receipt = try JSONDecoder().decode(JSONValue.self, from: bytes)
                    }
                    try Task.checkCancellation()
                    guard scope == generation else { return }
                    guard let receipt, ReceiptValidator.matches(receipt, job: job) else { throw APIError(status: 409, message: "The send receipt did not match. Check recent uploads before retrying.") }
                    if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index].receipt = receipt.fields; jobs[index].message = nil; try save() }
                } catch is CancellationError { guard scope == generation else { return }; message = "Sending stopped. Retry remaining uses the same send IDs."; return }
                catch {
                    guard scope == generation else { return }
                    if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index].message = error.localizedDescription; try? save() }
                    message = error.localizedDescription; return
                }
            }
            message = "Sent. The computer still needs to save your files."
        }
    }
    func clearFinished() {
        guard ledgerReadable, !busy else { return }
        let finished = jobs.filter(\.isFinished), remaining = jobs.filter { !$0.isFinished }
        let previous = jobs; jobs = remaining
        do { try save(); for job in finished { try? FileManager.default.removeItem(at: job.localFile) } }
        catch { jobs = previous; message = error.localizedDescription }
    }
    func refreshReceipts(only jobID: String? = nil) async {
        let scope = generation
        for job in jobs where job.receipt != nil && (jobID == nil || job.id == jobID) {
            do {
                let current = try await api.request("/uploads/" + job.id + "?deviceId=" + job.deviceID)
                try Task.checkCancellation()
                guard scope == generation else { return }
                if ReceiptValidator.matches(current, job: job), let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index].receipt = current.fields }
            } catch is CancellationError { return }
            catch { }
        }
        guard scope == generation else { return }
        try? save()
    }
}

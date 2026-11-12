import SwiftUI
import UniformTypeIdentifiers

struct ServiceSongRequestsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let computerID: String
    let serviceID: String
    let title: String
    @State private var snapshot = JSONValue.null
    @State private var message = ""
    @State private var loading = false
    @State private var submitting = false
    @State private var preparing = false
    @State private var choosingFile = false
    @State private var songTitle = ""
    @State private var details = ""
    @State private var attachmentID = ""
    @State private var requestID = UUID().uuidString.lowercased()
    @State private var pendingRequest: JSONValue?

    private var path: String { "/computers/" + computerID + "/services/" + serviceID + "/requests" }
    private var attachments: [APIRecord] { snapshot["attachments"].records }
    private var transfer: UploadJob? { store.uploads.jobs.first { $0.id == attachmentID && $0.deviceID == computerID } }
    private var attachment: APIRecord? { attachments.first { $0["transferId"].text == attachmentID && $0["available"].flag } }
    private var canSubmit: Bool { snapshot["canSubmit"].flag }
    private var validText: Bool {
        let name = songTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
        return !name.isEmpty && name.count <= 120 && note.count <= 5000
    }

    var body: some View {
        NavigationStack {
            Form {
                if loading && snapshot == .null { ProgressView("Loading requests…") }
                if !message.isEmpty { NoticeView(text: message) }
                if canSubmit {
                    Section {
                        TextField("Song title", text: $songTitle).disabled(pendingRequest != nil)
                        TextField("Lyrics or notes", text: $details, axis: .vertical).lineLimit(3...7).disabled(pendingRequest != nil)
                        if !attachments.isEmpty || transfer != nil {
                            Picker("Attachment", selection: $attachmentID) {
                                Text("None").tag("")
                                if let transfer, attachment == nil { Text(transfer.filename).tag(transfer.id) }
                                ForEach(attachments, id: \.transferID) { file in Text(file["filename"].text).tag(file["transferId"].text) }
                            }
                            .disabled(preparing || pendingRequest != nil)
                        }
                        Button("Upload song file", systemImage: "tray.and.arrow.up") { choosingFile = true }
                            .disabled(preparing || submitting || store.uploads.busy || store.uploads.availableSlots == 0 || pendingRequest != nil)
                        if let transfer, attachment == nil {
                            Text(transfer.status).font(.footnote).foregroundStyle(.secondary)
                            if transfer.receipt == nil, !store.uploads.busy {
                                Button("Retry this upload") { store.uploads.send(only: transfer.id) }
                            } else if transfer.receipt != nil && !transfer.isFinished {
                                Button("Check delivery") { Task { await refresh() } }
                            }
                        }
                        if preparing { ProgressView("Preparing file…") }
                        Button(pendingRequest == nil ? "Submit song request" : "Retry song request", systemImage: "paperplane") { Task { await submit() } }
                            .disabled(submitting || preparing || !validText || (!attachmentID.isEmpty && attachment == nil))
                    } header: { Text("Request a song") } footer: {
                        Text("The presentation computer must save an uploaded file before you can attach it. Submit the request for the team to review and add to the running order.")
                    }
                }
                Section("Requests for " + title) {
                    if snapshot["items"].items.isEmpty && !loading { Text("No song requests yet.").foregroundStyle(.secondary) }
                    ForEach(snapshot["items"].records) { request in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(request.title).font(.headline)
                            Text(request["authorName"].text + " · " + status(request["status"].text)).font(.subheadline).foregroundStyle(.secondary)
                            if !request["body"].text.isEmpty { Text(request["body"].text) }
                            if !request["attachment"]["filename"].text.isEmpty {
                                Label(request["attachment"]["filename"].text, systemImage: "paperclip").font(.footnote)
                            }
                            if !request["statusNote"].text.isEmpty { Text(request["statusNote"].text).font(.footnote).foregroundStyle(.secondary) }
                        }.padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("Song Requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly).disabled(submitting) }
            }
            .refreshable { await refresh() }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.data]) { result in
                switch result {
                case .success(let url): Task { await upload(url) }
                case .failure(let error): message = error.localizedDescription
                }
            }
            .task { await refresh() }
            .task(id: attachmentID) {
                guard let transfer, attachment == nil, !transfer.isFinished else { return }
                while !Task.isCancelled {
                    do {
                        try await Task.sleep(for: .seconds(4))
                        if !store.uploads.busy, self.transfer?.receipt != nil {
                            await refresh()
                            if attachment != nil || self.transfer?.isFinished == true { return }
                        }
                    } catch { return }
                }
            }
            .onChange(of: store.accountEpoch) { dismiss() }
            .onChange(of: store.selectedComputer) { dismiss() }
        }
    }

    private func refresh() async {
        guard !loading, !submitting, computerID == store.selectedComputer else { return }
        let epoch = store.accountEpoch
        loading = true
        defer { loading = false }
        do {
            if let transfer, transfer.receipt != nil, !transfer.isFinished { await store.uploads.refreshReceipts(only: transfer.id) }
            let result = try await store.api.request(path)
            try Task.checkCancellation()
            guard epoch == store.accountEpoch, computerID == store.selectedComputer, !submitting else { return }
            snapshot = result
            message = ""
            if pendingRequest != nil, result["items"].records.contains(where: { $0.id == requestID }) { submitted() }
        } catch is CancellationError { }
        catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
    }

    private func upload(_ url: URL) async {
        guard canSubmit, !preparing, !store.uploads.busy, let owner = store.me?.id, computerID == store.selectedComputer else { return }
        let epoch = store.accountEpoch
        preparing = true
        defer { preparing = false }
        do {
            let job = try await UploadFiles.prepare(url: url, userID: owner, deviceID: computerID)
            do {
                try Task.checkCancellation()
                guard epoch == store.accountEpoch, computerID == store.selectedComputer else { throw CancellationError() }
                try store.uploads.append([job])
            } catch {
                try? FileManager.default.removeItem(at: job.localFile)
                throw error
            }
            if songTitle.isEmpty { songTitle = String(url.deletingPathExtension().lastPathComponent.prefix(120)) }
            attachmentID = job.id
            message = ""
            store.uploads.send(only: job.id)
        } catch is CancellationError { }
        catch { message = error.localizedDescription }
    }

    private func submit() async {
        guard canSubmit, validText, !submitting, computerID == store.selectedComputer,
              attachmentID.isEmpty || attachment != nil else { return }
        let epoch = store.accountEpoch
        let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let reference = attachment.map { JSONValue.object(["transferId": $0["transferId"], "sha256": $0["sha256"]]) } ?? .null
        let payload = pendingRequest ?? .object([
            "type": .string("create"), "id": .string(requestID),
            "title": .string(songTitle.trimmingCharacters(in: .whitespacesAndNewlines)),
            "body": .string(note.isEmpty ? "Please add this song to the service." : note),
            "placement": .string(""), "deadline": .null, "assigneeId": .null, "attachment": reference
        ])
        pendingRequest = payload
        submitting = true
        defer { submitting = false }
        do {
            let result = try await store.api.request(path, method: "POST", body: payload)
            guard epoch == store.accountEpoch, computerID == store.selectedComputer else { return }
            guard result["items"].records.contains(where: { $0.id == requestID }) else {
                throw APIError(status: 0, message: "Couldn’t confirm the request. Refresh or retry.")
            }
            snapshot = result
            submitted()
        } catch {
            guard epoch == store.accountEpoch else { return }
            if let failure = error as? APIError, [400, 401, 403, 404, 413].contains(failure.status) { pendingRequest = nil }
            message = error.localizedDescription
        }
    }

    private func submitted() {
        pendingRequest = nil
        requestID = UUID().uuidString.lowercased()
        songTitle = ""
        details = ""
        attachmentID = ""
        message = "Song request submitted."
    }

    private func status(_ value: String) -> String {
        switch value {
        case "received": "Received"
        case "needs-correction": "Needs correction"
        case "approved": "Approved"
        case "added": "Added to service"
        default: "Waiting for review"
        }
    }
}


private extension APIRecord {
    var transferID: String { self["transferId"].text }
}

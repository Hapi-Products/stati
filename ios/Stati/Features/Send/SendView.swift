import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct SendView: View {
    @Environment(AppStore.self) private var store
    let active: Bool
    @State private var importing = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var receivers: [APIRecord] = []
    @State private var textMode = false
    @State private var preparing = false
    @State private var error = ""
    init(active: Bool) {
        self.active = active
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "send-photos" { _pickingPhotos = State(initialValue: true) }
        if NativeReview.route == "send-text" { _textMode = State(initialValue: true) }
        #endif
    }
    var body: some View {
        List {
            if store.uploads.needsRecovery {
                Section {
                    NoticeView(text: store.uploads.message)
                    Button("Retry reading send list", systemImage: "arrow.clockwise") { store.uploads.retryReading() }
                        .disabled(preparing || store.uploads.busy)
                }
            } else {
                Section {
                    if store.uploads.jobs.isEmpty {
                        ContentUnavailableView("No files to send", systemImage: "doc.badge.plus", description: Text("Add files, photos or song text."))
                    } else {
                        ForEach(store.uploads.jobs) { job in
                            VStack(alignment: .leading, spacing: 4) {
                                Label(job.filename, systemImage: "doc").font(.body.weight(.medium))
                                Text(job.status).font(.footnote).foregroundStyle(Color.statiSecondary)
                            }.padding(.vertical, 2)
                        }
                    }
                } header: {
                    HStack {
                        Text(store.uploads.jobs.count == 1 ? "1 file" : "\(store.uploads.jobs.count) files")
                        Spacer()
                        if !store.uploads.busy && store.uploads.jobs.contains(where: \.isFinished) {
                            Button("Clear finished sends", systemImage: "checkmark.circle") { store.uploads.clearFinished() }.labelStyle(ActionIconLabelStyle())
                        }
                    }
                }
                if preparing { ProgressView("Preparing files…") }
                if store.uploads.busy { ProgressView(store.uploads.currentName.isEmpty ? "Checking receipts…" : "Sending " + store.uploads.currentName) }
                if !error.isEmpty || !store.uploads.message.isEmpty {
                    Section { NoticeView(text: error.isEmpty ? store.uploads.message : error) }
                }
            }
        }
        .contentMargins(.top, 8, for: .scrollContent)
        .navigationTitle("Send").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { SendComputerPicker(receivers: receivers) }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Add material", systemImage: "plus") {
                    Button("Files", systemImage: "folder") { importing = true }
                    Button("Photos", systemImage: "photo") { pickingPhotos = true }
                    Button("Song text", systemImage: "text.alignleft") { textMode = true }
                }.labelStyle(ActionIconLabelStyle())
                    .disabled(store.selectedComputer.isEmpty || preparing || store.uploads.busy || store.uploads.availableSlots == 0)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !store.uploads.needsRecovery && (store.uploads.busy || store.uploads.jobs.contains(where: { $0.receipt == nil })) {
                HStack {
                    if store.uploads.busy { Button("Stop sending", systemImage: "stop") { store.uploads.cancel() } }
                    else {
                        Button(sendActionTitle, systemImage: "paperplane.fill") { store.uploads.send() }
                            .buttonStyle(.borderedProminent).tint(AppIconAppearance.shared.fill).foregroundStyle(.white)
                            .disabled(preparing || !store.uploads.jobs.contains(where: { $0.receipt == nil }))
                    }
                }.frame(maxWidth: .infinity).padding(12).background(.bar)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
            switch result { case .success(let urls): Task { _ = await stage(urls) }; case .failure(let failure): error = failure.localizedDescription }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: max(1, store.uploads.availableSlots), matching: .images)
        .sheet(isPresented: $textMode) { SongTextComposer(preparing: preparing, message: error) { await addText() } }
        .onChange(of: photos) { _, items in Task { await stagePhotos(items) } }
        .refreshable { await refresh() }
        .task(id: active) {
            guard active else { return }
            while !Task.isCancelled {
                await refresh()
                if !store.selectedComputer.isEmpty { _ = try? await store.api.request("/connections/presence", method: "POST", body: .object(["deviceIds": .array([.string(store.selectedComputer)])])) }
                do { try await Task.sleep(for: .seconds(20)) } catch { break }
            }
        }
    }
    private var sendActionTitle: String {
        let count = store.uploads.jobs.filter { $0.receipt == nil }.count
        return count == 1 ? "Send 1 file" : "Send \(count) files"
    }
    private func refresh() async {
        do { receivers = try await store.api.request("/receivers").records; await store.uploads.refreshReceipts() }
        catch { if !(error is CancellationError) { self.error = error.localizedDescription } }
    }
    private func stage(_ urls: [URL]) async -> Bool {
        guard let userID = store.me?.id, !store.selectedComputer.isEmpty else { error = "Choose a computer first."; return false }
        guard !preparing, !store.uploads.busy else { error = "Wait for the current files to finish preparing or sending."; return false }
        guard !urls.isEmpty, urls.count <= store.uploads.availableSlots else { error = "You can add \(store.uploads.availableSlots) more files. Wait for the computer to finish the current sends."; return false }
        preparing = true; defer { preparing = false }; let device = store.selectedComputer
        do {
            try await FileStager.stage(count: urls.count, queue: store.uploads) { index in try await UploadFiles.prepare(url: urls[index], userID: userID, deviceID: device) }
            error = ""; return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func stagePhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        guard !preparing, !store.uploads.busy else { error = "Wait for the current files to finish preparing or sending."; photos = []; return }
        guard let userID = store.me?.id, !store.selectedComputer.isEmpty else { error = "Choose a computer first."; photos = []; return }
        guard items.count <= store.uploads.availableSlots else { error = "You can add \(store.uploads.availableSlots) more files. Wait for the computer to finish the current sends."; photos = []; return }
        preparing = true
        defer { preparing = false; photos = [] }
        let device = store.selectedComputer
        do {
            try await FileStager.stage(count: items.count, queue: store.uploads) { index in
                guard let data = try await items[index].loadTransferable(type: Data.self) else { throw APIError(status: 0, message: "One photo could not be opened. Choose the photos again.") }
                let url = try await UploadFiles.photo(data: data)
                defer { try? FileManager.default.removeItem(at: url) }
                return try await UploadFiles.prepare(url: url, userID: userID, deviceID: device)
            }
            error = ""
        } catch { self.error = error.localizedDescription }
    }
    private func addText() async -> Bool {
        let draft = store.sendDraft, owner = store.me?.id
        let name = draft.title.trimmingCharacters(in: .whitespacesAndNewlines).replacing("/", with: "_").replacing("\\", with: "_")
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let url = directory.appending(path: String((name.isEmpty ? "Song request" : name).prefix(100)) + ".txt")
            try Data(draft.text.utf8).write(to: url, options: .atomic)
            guard await stage([url]) else { return false }
            if store.me?.id == owner, store.sendDraft == draft { store.sendDraft = SendDraft() }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}

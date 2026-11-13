import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct SendView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let active: Bool
    @State private var importing = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var receivers: [APIRecord] = []
    @State private var receiversKnown = false
    @State private var refreshing = false
    @State private var connectionMessage = ""
    @State private var importingSong = false
    @State private var songOffer: UploadJob?
    @State private var localPreview: SavedSendPreview?
    @State private var previewURL: URL?
    @State private var banner = ""
    @State private var now = Date.now
    @State private var previewing = false
    @State private var textMode = false
    @State private var connectingComputer = false
    @State private var preparing = false
    @State private var error = ""
    init(active: Bool) {
        self.active = active
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "send-photos" { _pickingPhotos = State(initialValue: true) }
        if NativeReview.route == "send-text" { _textMode = State(initialValue: true) }
        #endif
    }
    private var savedSongs: [UploadJob] { store.uploads.jobs.filter { $0.hasSavedSong(at: now) } }
    private var unclaimedSongID: String? { store.uploads.jobs.first(where: \.offersSongCopy)?.id }

    var body: some View {
        List {
            if !connectionMessage.isEmpty {
                NoticeView(text: connectionMessage)
            }
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
                                if let computer = store.computers.first(where: { $0.id == job.deviceID }) {
                                    Text(computer.name).font(.caption).foregroundStyle(.secondary)
                                }
                                if job.offersSongCopy {
                                    Button("Save for Today", systemImage: "clock") { songOffer = job }
                                        .buttonStyle(.borderless)
                                }
                            }.padding(.vertical, 2)
                        }
                    }
                } header: {
                    HStack {
                        Text(store.uploads.jobs.count == 1 ? "1 file" : "\(store.uploads.jobs.count) files")
                        Spacer()
                        if !store.uploads.busy && store.uploads.jobs.contains(where: { $0.isFinished && !$0.hasSavedSong(at: now) && !$0.offersSongCopy }) {
                            Button("Clear finished sends", systemImage: "checkmark.circle") { store.uploads.clearFinished() }.labelStyle(ActionIconLabelStyle())
                        }
                    }
                }
                if !savedSongs.isEmpty {
                    Section("Saved Songs") {
                        ForEach(savedSongs) { job in
                            Button {
                                Task { await openSavedSong(job) }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(job.filename)
                                    Text(job.verifiedStatus == "delivered" ? "Saved on this device" : "Available today")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .disabled(previewing)
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
            ToolbarItem(placement: .principal) {
                SendComputerPicker(receivers: receivers, statusKnown: receiversKnown) { connectingComputer = true }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if store.isAdmin { BuildPauseControl(active: active) }
                Menu("Add material", systemImage: "plus") {
                    Button("Files", systemImage: "folder") { importingSong = false; importing = true }
                    Button("Song File", systemImage: "music.note") { importingSong = true; importing = true }
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
            switch result { case .success(let urls): let song = importingSong; Task { _ = await stage(urls, song: song) }; case .failure(let failure): error = failure.localizedDescription }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: max(1, store.uploads.availableSlots), matching: .images)
        .sheet(isPresented: $connectingComputer) { ConnectComputerView() }
        .sheet(isPresented: $textMode) { SongTextComposer(preparing: preparing, message: error, add: { await addText() }) }
        .onChange(of: photos) { _, items in Task { await stagePhotos(items) } }
        .confirmationDialog("Save this song on this device for today?", isPresented: Binding(get: { songOffer != nil }, set: { if !$0 { songOffer = nil } }), titleVisibility: .visible, presenting: songOffer) { job in
            Button("Save for Today") { store.uploads.keepSongCopy(job.id, keep: true); now = .now }
            Button("Don’t Save", role: .cancel) { store.uploads.keepSongCopy(job.id, keep: false) }
        } message: { job in
            Text(job.filename + " stays available today. If the computer saves it, the copy stays on this device.")
        }
        .fullScreenCover(item: $localPreview, onDismiss: closeSavedSong) { preview in
            AppleMarkupView(url: preview.url, filename: preview.url.lastPathComponent, canEdit: false, saved: { _ in }, close: { localPreview = nil })
                .ignoresSafeArea()
        }
        .onChange(of: store.accountEpoch) { localPreview = nil; songOffer = nil; receivers = []; receiversKnown = false; banner = "" }
        .onChange(of: savedSongs.map(\.id)) { _, ids in
            if let localPreview, !ids.contains(localPreview.jobID) { self.localPreview = nil }
        }
        .onChange(of: unclaimedSongID) { _, id in
            if active, songOffer == nil, let id { songOffer = store.uploads.jobs.first { $0.id == id } }
        }
        .onChange(of: store.uploads.jobs.filter { ["queued", "delivered"].contains($0.verifiedStatus ?? "") }.map(\.id)) { before, after in
            if after.contains(where: { !before.contains($0) }) && unclaimedSongID == nil { banner = "Sent to the computer" }
        }
        .overlay(alignment: .top) {
            if active && !banner.isEmpty && songOffer == nil {
                Label(banner, systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.top, 7)
                    .allowsHitTesting(false)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.18) : .smooth(duration: 0.3), value: banner)
        .task(id: banner) {
            guard !banner.isEmpty else { return }
            do { try await Task.sleep(for: .seconds(3)); banner = "" } catch { }
        }
        .refreshable { await refresh() }
        .task(id: active && scenePhase == .active) {
            guard active, scenePhase == .active else { return }
            while !Task.isCancelled {
                now = .now
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
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let epoch = store.accountEpoch
        do {
            let result: JSONValue
            do { result = try await store.api.request("/receivers") }
            catch where OfflineReadPolicy.permits(error) {
                try await Task.sleep(for: .milliseconds(500))
                result = try await store.api.request("/receivers")
            }
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            receivers = result.records
            receiversKnown = true
            connectionMessage = ""
        } catch is CancellationError { return }
        catch {
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            receiversKnown = false
            connectionMessage = OfflineReadPolicy.permits(error) ? "Couldn’t check computer status. Stați will retry when it reconnects." : error.localizedDescription
        }
        await store.uploads.refreshReceipts()
    }

    private func openSavedSong(_ job: UploadJob) async {
        guard !previewing, store.me?.id == job.userID, job.hasSavedSong(at: .now) else { return }
        previewing = true
        defer { previewing = false }
        do {
            let url = try NativePreview.stage(data: Data(contentsOf: job.localFile, options: .mappedIfSafe), filename: job.filename)
            previewURL = url
            localPreview = SavedSendPreview(url: url, jobID: job.id)
        } catch { self.error = "The saved copy could not be opened." }
    }

    private func closeSavedSong() {
        if let previewURL { NativePreview.remove(previewURL) }
        previewURL = nil
    }

    private func stage(_ urls: [URL], song: Bool = false) async -> Bool {
        guard let userID = store.me?.id, !store.selectedComputer.isEmpty else { error = "Choose a computer first."; return false }
        guard !preparing, !store.uploads.busy else { error = "Wait for the current files to finish preparing or sending."; return false }
        guard !urls.isEmpty, urls.count <= store.uploads.availableSlots else { error = "You can add \(store.uploads.availableSlots) more files. Wait for the computer to finish the current sends."; return false }
        preparing = true; defer { preparing = false }; let device = store.selectedComputer
        do {
            try await FileStager.stage(count: urls.count, queue: store.uploads) { index in
                var job = try await UploadFiles.prepare(url: urls[index], userID: userID, deviceID: device)
                if song { job.isSongSubmission = true }
                return job
            }
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
        guard let owner = store.me?.id, !store.selectedComputer.isEmpty else { error = "Choose a computer first."; return false }
        guard !preparing, !store.uploads.busy, store.uploads.availableSlots > 0 else { return false }
        preparing = true
        defer { preparing = false }
        let draft = store.sendDraft, computer = store.selectedComputer
        do {
            try await FileStager.stage(count: 1, queue: store.uploads) { _ in
                try await UploadFiles.prepareSongText(draft, userID: owner, deviceID: computer)
            }
            if store.me?.id == owner, store.sendDraft == draft { store.sendDraft = SendDraft() }
            error = ""
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}


private struct SavedSendPreview: Identifiable {
    let url: URL
    let jobID: String
    var id: URL { url }
}

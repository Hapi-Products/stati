import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ShareGroupFileView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let shared: () -> Void
    private let initialScan: GroupScanDraft?
    private let opensPhotos: Bool
    @State private var pickingPhoto = false
    @State private var photo: PhotosPickerItem?
    @State private var stagedPhoto: URL?
    @State private var photoPreview: UIImage?
    @State private var photoTask: Task<Void, Never>?
    @State private var preparingPhoto = false
    @State private var groupID = ""
    @State private var namedGroups: WorshipGroupsModel?
    @State private var scan: GroupScanDraft?
    @State private var title = ""
    @State private var groupName = ""
    @State private var file: URL?
    @State private var importing = false
    @State private var reviewing = false
    @State private var shareGate = ScanShareGate()
    @State private var busy = false
    @State private var uncertain = false
    @State private var message = ""
    @State private var ownerID = ""
    @State private var epoch = UUID()
    init(initialScan: GroupScanDraft? = nil, initialGroupID: String? = nil, opensPhotos: Bool = false, shared: @escaping () -> Void) {
        self.initialScan = initialScan; self.opensPhotos = opensPhotos; self.shared = shared
        _groupID = State(initialValue: initialScan?.groupID ?? initialGroupID ?? "")
        _scan = State(initialValue: initialScan)
        _title = State(initialValue: initialScan?.title ?? "")
        _groupName = State(initialValue: initialScan?.groupName ?? "")
        _uncertain = State(initialValue: initialScan?.sharingUnconfirmed ?? false)
        _file = State(initialValue: initialScan.flatMap { try? GroupScanStorage.verifiedFile($0) })
    }
    private var active: Bool { !ownerID.isEmpty && ownerID == store.me?.id && epoch == store.accountEpoch && (scan == nil || scan?.ownerID == ownerID) }
    private var legacyPending: Bool { scan?.sharingUnconfirmed == true && scan?.groupID == nil }
    private var validGroup: Bool { !groupID.isEmpty && namedGroups?.groups.contains(where: { $0.id == groupID }) == true }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title, prompt: Text("Title").foregroundStyle(Color.statiSecondary)).disabled(uncertain)
                if legacyPending { LabeledContent("Existing shared group", value: groupName) }
                else {
                    Picker("Group", selection: $groupID) {
                        Text("Choose a group").tag("")
                        if !groupID.isEmpty && !validGroup { Text(groupName.isEmpty ? "Unavailable group" : groupName).tag(groupID).disabled(true) }
                        ForEach(namedGroups?.groups ?? []) { group in Text(group.name).tag(group.id) }
                    }.disabled(uncertain)
                    if let namedGroups, namedGroups.canCreate { NavigationLink("Manage groups") { WorshipGroupsManagementView(store: store, groups: namedGroups) } }
                }
                if initialScan != nil {
                    Button("Review scan", systemImage: "doc.viewfinder") { reviewing = true }.disabled(file == nil)
                } else {
                    Button(stagedPhoto != nil ? "Photo selected" : file?.lastPathComponent ?? "Choose PDF or image", systemImage: "doc.badge.plus") { importing = true }.disabled(uncertain || preparingPhoto)
                    Button("Choose from Photos", systemImage: "photo.on.rectangle") { pickingPhoto = true }.disabled(uncertain || preparingPhoto)
                    if let photoPreview {
                        Image(uiImage: photoPreview).resizable().scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 180)
                            .accessibilityLabel("Selected photo")
                    }
                    if preparingPhoto { ProgressView("Preparing photo…") }
                }
                Text(legacyPending ? "This earlier scan was shared with the ministry team. Its original destination is kept while checking the result." : "Visible to the selected group’s members and administrators. PDF, JPG, PNG or WebP · up to 12 MB.").font(.footnote).foregroundStyle(Color.statiSecondary)
                if uncertain {
                    Text("Sharing was not confirmed. Check group files to see whether the file arrived.").font(.footnote).foregroundStyle(Color.statiSecondary)
                    if scan != nil { Button("Check group files for this scan", systemImage: "arrow.clockwise") { Task { await reconcile() } } }
                }
                NoticeView(text: message)
                if busy { ProgressView("Checking or sharing…") }
            }.disabled(busy).navigationTitle("Group File").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(initialScan == nil ? "Cancel" : "Done", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Share group file", systemImage: "square.and.arrow.up") { Task { await share() } }.labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle).disabled(!validGroup || !active || !store.canPlan || busy || preparingPhoto || !shareGate.canShare(scanID: scan?.id, uncertain: uncertain) || file == nil || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
                .interactiveDismissDisabled(busy)
                .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png, .webP]) { result in switch result { case .success(let url): clearStagedPhoto(); file = url; case .failure(let error): message = error.localizedDescription } }
                .photosPicker(isPresented: $pickingPhoto, selection: $photo, matching: .images)
                .onChange(of: photo) { _, selection in
                    guard let selection else { return }
                    photoTask?.cancel()
                    photoTask = Task { await preparePhoto(selection) }
                }
                .fullScreenCover(isPresented: $reviewing, onDismiss: { if active, file != nil, let scan { shareGate.finishReview(scanID: scan.id) } }) { if let file { ScanDocumentReview(url: file, title: title) } }
                .task {
                    ownerID = store.me?.id ?? ""; epoch = store.accountEpoch
                    let groups = WorshipGroupsModel(store: store); namedGroups = groups; await groups.load()
                    guard active else { return }
                    if !legacyPending {
                        if groupID.isEmpty && groups.groups.count == 1 { groupID = groups.groups[0].id }
                        syncDestination()
                    }
                    if opensPhotos, initialScan == nil, validGroup { pickingPhoto = true }
                    if initialScan != nil && file == nil { message = "This scan could not be verified. Its existing files have been kept." }
                    if initialScan != nil, file != nil, shareGate.reviewedScanID != scan?.id { reviewing = true }
                }
                .onChange(of: groupID) { syncDestination() }
                .onChange(of: namedGroups?.revision) { if !uncertain { if groupID.isEmpty && namedGroups?.groups.count == 1 { groupID = namedGroups?.groups.first?.id ?? "" }; syncDestination() } }
                .onChange(of: title) { persistScan() }.onChange(of: groupName) { persistScan() }
                .onChange(of: store.accountEpoch) { dismiss() }
        }
        .onDisappear {
            photoTask?.cancel()
            clearStagedPhoto()
        }
    }
    private func preparePhoto(_ selection: PhotosPickerItem) async {
        guard active, !busy, !uncertain else { return }
        preparingPhoto = true
        message = ""
        defer { preparingPhoto = false; photo = nil }
        do {
            guard let data = try await selection.loadTransferable(type: Data.self) else {
                throw APIError(status: 415, message: "This photo could not be opened.")
            }
            let url = try await UploadFiles.photo(data: data, maximumPixels: 4096)
            guard !Task.isCancelled, active else { try? FileManager.default.removeItem(at: url); return }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard (1...(12 * 1024 * 1024)).contains(size) else {
                try? FileManager.default.removeItem(at: url)
                throw APIError(status: 413, message: "Choose a photo that can be shared within the 12 MB file limit.")
            }
            clearStagedPhoto()
            stagedPhoto = url
            photoPreview = PreviewImage.decode(data, maximumPixels: 640)
            file = url
            if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { title = "Photo" }
        } catch is CancellationError { }
        catch { if active { message = error.localizedDescription } }
    }

    private func clearStagedPhoto() {
        guard let url = stagedPhoto else { return }
        try? FileManager.default.removeItem(at: url)
        stagedPhoto = nil
        photoPreview = nil
        if file == url { file = nil }
    }

    private func syncDestination() {
        guard !uncertain, let group = namedGroups?.groups.first(where: { $0.id == groupID }) else { return }
        groupName = group.name; persistScan()
    }
    private func persistScan() {
        guard active, !busy, !uncertain, var value = scan else { return }
        value.title = title; value.groupName = groupName; value.groupID = groupID.isEmpty ? nil : groupID
        do { try GroupScanStorage.save(value); scan = value; message = "" } catch { message = error.localizedDescription }
    }
    private func share() async {
        guard active, store.canPlan, validGroup, !busy, !preparingPhoto, shareGate.canShare(scanID: scan?.id, uncertain: uncertain), let file else { return }
        let scoped = file.startAccessingSecurityScopedResource(); defer { if scoped { file.stopAccessingSecurityScopedResource() } }
        busy = true; defer { busy = false }
        do {
            let bytes = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard (1...(12 * 1024 * 1024)).contains(bytes) else { throw APIError(status: 413, message: "Choose a non-empty file up to 12 MB.") }
            if var value = scan {
                _ = try GroupScanStorage.verifiedFile(value)
                value.title = title; value.groupName = groupName; value.groupID = groupID.isEmpty ? nil : groupID; value.sharingUnconfirmed = true
                try GroupScanStorage.save(value); scan = value
            }
            guard shareGate.beginShare(scanID: scan?.id, uncertain: uncertain) else { return }
            uncertain = true
            let path = "/group-materials?title=" + title.queryEncoded + "&groupName=" + groupName.queryEncoded + "&filename=" + file.lastPathComponent.queryEncoded + "&groupId=" + groupID.queryEncoded
            let response = try await store.api.upload(path, file: file, headers: ["Content-Type": "application/octet-stream", "Content-Length": String(bytes)])
            guard active else { return }
            let receipt = try JSONDecoder().decode(JSONValue.self, from: response)
            guard receipt["ok"].flag, UUID(uuidString: receipt["id"].text) != nil else { throw APIError(status: 409, message: "The shared copy was not confirmed. Check group files before trying again.") }
            if let scan { try GroupScanStorage.remove(scan) }
            shared(); dismiss()
        } catch let error as APIError where [400, 413, 415].contains(error.status) {
            guard active else { return }
            shareGate.allowCorrection()
            if var value = scan {
                value.sharingUnconfirmed = false
                do { try GroupScanStorage.save(value); scan = value; uncertain = false } catch { message = error.localizedDescription; return }
            } else { uncertain = false }
            message = error.localizedDescription
        } catch { if active { message = error.localizedDescription } }
    }
    private func reconcile() async {
        guard active, !busy, let scan else { return }
        busy = true; defer { busy = false }
        do {
            let found = try await GroupScanReconciler.find(draft: scan, store: store)
            guard active else { return }
            if found { try GroupScanStorage.remove(scan); shared(); dismiss() }
            else { message = "This scan was not found in the checked shared files. It is still kept on this iPad." }
        } catch is CancellationError { }
        catch { if active { message = error.localizedDescription } }
    }
}

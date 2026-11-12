import SwiftUI
import VisionKit

struct IPadSharedFilesView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let store: AppStore
    let defaultGroup: String
    let groupID: String?
    let groupTitle: String?
    let groups: WorshipGroupsModel?
    let switchGroup: ((String) -> Void)?
    @State private var guide = WorshipGuide()
    @State private var actions: WorshipGroupActions?
    private let ownerID: String
    private let epoch: UUID
    @State private var snapshot = GroupFileSnapshot()
    private var files: [APIRecord] { snapshot.files }
    @State private var nextCursor = ""
    private var canUpload: Bool { snapshot.canUpload }
    @State private var query = ""
    @State private var listMode = false
    @State private var reader: ReaderPreferences?
    private var largePreviews: Bool { reader?.settings.largePreviews == true }
    @State private var loading = false
    @State private var message = ""
    @State private var generation = UUID()
    @State private var sharing = false
    @State private var scanning = false
    @State private var pendingScan: GroupScanDraft?
    @State private var reviewScan: GroupScanDraft?
    @State private var savedScans: [GroupScanDraft] = []
    @State private var scanRecoveryError = false
    @State private var scanMessage = ""
    @State private var preview: FilePreviewRequest?
    @State private var removing: APIRecord?
    @State private var discarding: GroupScanDraft?
    init(store: AppStore, defaultGroup: String, groupID: String? = nil, groupTitle: String? = nil, groups: WorshipGroupsModel? = nil, switchGroup: ((String) -> Void)? = nil) { self.store = store; self.defaultGroup = defaultGroup; self.groupID = groupID; self.groupTitle = groupTitle; self.groups = groups; self.switchGroup = switchGroup; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch }
    private var active: Bool { !ownerID.isEmpty && store.me?.id == ownerID && store.accountEpoch == epoch }
    private var canManageGroup: Bool { groupID.map { id in groups?.groups.first(where: { $0.id == id })?["canManage"].flag == true } ?? false }
    private var matching: [APIRecord] { files.filter { (groupID != nil || defaultGroup == "__generic__" || defaultGroup.isEmpty || $0["groupName"].text.localizedStandardCompare(defaultGroup) == .orderedSame) && (query.isEmpty || [$0.title, $0["filename"].text, $0["groupName"].text].contains(where: { $0.localizedStandardContains(query) })) } }
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if listMode || dynamicTypeSize.isAccessibilitySize { fileList }
                else { LazyVGrid(columns: WorshipPreviewGrid.columns(large: largePreviews), alignment: .leading, spacing: WorshipPreviewGrid.spacing) { ForEach(matching) { file in fileButton(file) { IPadSharedFileTile(store: store, file: file, large: largePreviews, showsGroupName: false) } } }.padding(24) }
                if loading { ProgressView("Loading shared files…").padding() }
                if !loading && matching.isEmpty && message.isEmpty { ContentUnavailableView(query.isEmpty ? "No shared group files" : "No matches in loaded files", systemImage: "doc.on.doc", description: Text(query.isEmpty ? "Shared song notes and scanned documents appear here." : "Load older files to include them in your search.")) }
                NoticeView(text: scanMessage).padding(.horizontal, 24)
                NoticeView(text: message).padding(.horizontal, 24)
                NoticeView(text: actions?.message ?? "").padding(.horizontal, 24)
                if !nextCursor.isEmpty { Button("Load older files", systemImage: "arrow.down") { Task { await load(more: true) } }.disabled(loading).padding() }
            }
            if !savedScans.isEmpty { Menu("Continue a scan", systemImage: "doc.viewfinder") { ForEach(savedScans) { scan in Button(scan.title) { reviewScan = scan }; Button("Discard " + scan.title, role: .destructive) { discarding = scan } } }.padding(.vertical, 8) }
        }.navigationTitle(groupTitle ?? "Groups").navigationBarTitleDisplayMode(.large)
            .toolbar {
                if let switchGroup, let groups, !groups.groups.isEmpty, groups.groups.count > 1 || store.isAdmin {
                    ToolbarItemGroup(placement: .topBarLeading) {
                        Menu("Switch worship group", systemImage: "person.2") {
                            ForEach(groups.groups) { group in
                                Button {
                                    switchGroup(group.id)
                                } label: {
                                    if group.id == groupID { Label(group.name, systemImage: "checkmark") }
                                    else { Text(group.name) }
                                }
                            }
                            if store.isAdmin {
                                Button("All groups") { switchGroup("") }
                            }
                        }
                        .labelStyle(.iconOnly)
                        .worshipGuide(guide, at: .groupSwitcher)
                        Button("Group switcher help", systemImage: "questionmark.circle") {
                            guide.start(.groups)
                        }.labelStyle(.iconOnly)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { Menu("View options", systemImage: listMode ? "list.bullet" : "square.grid.2x2") { Button("Grid", systemImage: "square.grid.2x2") { listMode = false }; Button("List", systemImage: "list.bullet") { listMode = true }; Toggle("Larger previews", isOn: Binding(get: { reader?.settings.largePreviews == true }, set: { reader?.settings.largePreviews = $0 })) }.labelStyle(ActionIconLabelStyle()) }
                if canUpload || groups?.canCreate == true || canManageGroup {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu("Add and manage", systemImage: "plus") {
                            if canUpload {
                                Button("Choose PDF or image", systemImage: "doc.badge.plus") { sharing = true }
                                Button("Scan Document", systemImage: "doc.viewfinder") { scanning = true }.disabled(!VNDocumentCameraViewController.isSupported || scanRecoveryError || !savedScans.isEmpty)
                            }
                            if groups?.canCreate == true { Button("New worship group", systemImage: "person.2.badge.plus") { actions?.create() } }
                            if canManageGroup, let groupID { Button("Group members", systemImage: "person.2") { Task { await actions?.edit(groupID) } } }
                            if let actions { ForEach(actions.drafts) { draft in Button("Continue " + (draft.name.isEmpty ? "group" : draft.name)) { actions.draft = draft } } }
                        }.labelStyle(ActionIconLabelStyle())
                    }
                }
            }
            .onAppear { if reader == nil { reader = ReaderPreferences(ownerID: ownerID, writesDeviceSettings: true) } }
            .onChange(of: scenePhase) { _, phase in if phase == .active { reader?.reload() } }
            .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in reader?.reload() }
            .searchable(text: $query, placement: .toolbar, prompt: "Search loaded group files").searchToolbarBehavior(.minimize)
            .fullScreenCover(item: $preview, onDismiss: { Task { await load() } }) { StatiFileViewer(request: $0) }
            .sheet(isPresented: $sharing, onDismiss: { Task { await load() } }) { ShareGroupFileView(initialGroupID: groupID) { sharing = false; Task { await load() } }.presentationSizing(.form) }
            .sheet(item: $reviewScan, onDismiss: loadScans) { scan in ShareGroupFileView(initialScan: scan) { reviewScan = nil; loadScans(); Task { await load() } }.presentationSizing(.form) }
            .sheet(isPresented: $scanning, onDismiss: { if active, let pendingScan { reviewScan = pendingScan; self.pendingScan = nil }; loadScans() }) { DocumentScanner(finished: scanned) }
            .confirmationDialog("Delete this group file?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                if let removing { Button("Delete file", role: .destructive) { Task { await remove(removing) } } }
            } message: { Text("People with access to this group will lose access to this shared copy. Your original stays on your device.") }
            .confirmationDialog("Discard this unshared scan?", isPresented: Binding(get: { discarding != nil }, set: { if !$0 { discarding = nil } }), titleVisibility: .visible) {
                if let discarding { Button("Discard scan", role: .destructive) { do { try GroupScanStorage.remove(discarding); self.discarding = nil; loadScans() } catch { message = error.localizedDescription } } }
            } message: { Text("The scanned PDF will be removed from this iPad. Any copy already in Shared stays available.") }
            .sheet(item: Binding(get: { actions?.draft }, set: { actions?.draft = $0 }), onDismiss: { actions?.loadDrafts() }) { draft in
                if let groups { WorshipGroupEditorView(store: store, groups: groups, draft: draft) { Task { await actions?.finished(); await load() } } }
            }
            .onChange(of: snapshot.accessRevision) { preview = nil; store.resources.clear() }
            .onChange(of: groups?.revision) {
                generation = UUID()
                snapshot.validate(namedIDs: groups?.loaded == true ? Set(groups?.groups.map(\.id) ?? []) : nil, selectedID: groupID)
                Task { await load() }
            }
            .onChange(of: store.fileChangeRevision) { Task { await load() } }
            .task {
                if let groups, actions == nil { actions = WorshipGroupActions(store: store, groups: groups); actions?.loadDrafts() }
                loadScans(); await load()
                #if DEBUG && targetEnvironment(simulator)
                if ["ipad-scan-review", "ipad-scan-pdf", "ipad-scan-form"].contains(NativeReview.route ?? "") {
                    do { reviewScan = try savedScans.first ?? GroupScanStorage.create(data: NativeScanChecks.pdf, ownerID: ownerID, group: "Choir") }
                    catch { scanMessage = error.localizedDescription }
                }
                if NativeReview.route == "ipad-group-delete" { removing = files.first }
                if ["ipad-file-preview", "ipad-markup"].contains(NativeReview.route ?? ""), let file = files.first { preview = FilePreviewItem(record: file, pathKey: "fileUrl").flatMap { selected in FilePreviewRequest(items: matching.filter { !$0["removalPending"].flag }.compactMap { FilePreviewItem(record: $0, pathKey: "fileUrl") }, selectedID: selected.id) } }
                #endif
            }.refreshable { loadScans(); await load() }
    }
    private var fileList: some View {
        LazyVStack(spacing: 10) {
            ForEach(matching) { file in
                fileButton(file) {
                    HStack(spacing: 16) {
                        Image(systemName: file["contentType"].text == "application/pdf" ? "doc.text" : "photo")
                            .font(.title2).frame(width: 44).foregroundStyle(.secondary)
                        Text(file.title).font(largePreviews ? .title3 : .body).foregroundStyle(.primary)
                        Spacer()
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .contentShape(.rect)
                }
            }
        }
        .padding(.vertical, 12)
    }
    private func fileButton<Content: View>(_ file: APIRecord, @ViewBuilder content: () -> Content) -> some View {
        Button {
            guard active else { return }
            preview = FilePreviewItem(record: file, pathKey: "fileUrl").flatMap { selected in FilePreviewRequest(items: matching.filter { !$0["removalPending"].flag }.compactMap { FilePreviewItem(record: $0, pathKey: "fileUrl") }, selectedID: selected.id) }
            if preview == nil { message = "This file link is unavailable. Refresh Shared and try again." }
        } label: { content() }.buttonStyle(.plain).disabled(file["removalPending"].flag)
            .contextMenu { if file["canDelete"].flag { Button("Delete", systemImage: "trash", role: .destructive) { removing = file } } }
    }
    private func load(more: Bool = false) async {
        guard active, !more || !loading && !nextCursor.isEmpty else { return }
        let scope = UUID(); generation = scope; loading = true; message = ""
        if !more { nextCursor = "" }
        defer { if generation == scope { loading = false } }
        do {
            let scopeQuery = groupID.map { "groupId=" + $0.queryEncoded } ?? (defaultGroup.isEmpty || defaultGroup == "__generic__" ? "" : "groupName=" + defaultGroup.queryEncoded)
            let result = try await store.api.request("/group-materials?" + scopeQuery + (more ? "&before=" + nextCursor.queryEncoded : ""))
            try Task.checkCancellation(); guard active && scope == generation else { return }
            let page = result["materials"].records
            snapshot.replace(page, canUpload: result["canUpload"].flag, more: more)
            nextCursor = result["nextCursor"].text
        } catch is CancellationError { }
        catch let error as APIError where [401, 403, 404].contains(error.status) {
            if active && scope == generation { snapshot.invalidateAccess(); preview = nil; nextCursor = ""; store.resources.clear(); message = error.localizedDescription }
        }
        catch { if active && scope == generation { message = error.localizedDescription } }
    }
    private func remove(_ file: APIRecord) async {
        guard active, file["canDelete"].flag else { return }
        do { _ = try await store.api.request("/group-materials/" + file.id, method: "DELETE"); guard active else { return }; store.recents.remove(id: "file::/api/group-materials/" + file.id + "/file"); store.resources.clear(); store.filesChanged(); removing = nil; await load() }
        catch { if active { message = error.localizedDescription } }
    }
    private func loadScans() {
        guard active else { return }
        do { savedScans = try GroupScanStorage.load(ownerID: ownerID); scanRecoveryError = false; scanMessage = "" }
        catch { scanRecoveryError = true; scanMessage = "A saved scan could not be opened. Its existing files have been kept. " + error.localizedDescription }
    }
    private func scanned(_ result: Result<Data?, Error>) {
        defer { scanning = false }
        guard active else { return }
        switch result {
        case .success(let data):
            guard let data else { return }
            do { pendingScan = try GroupScanStorage.create(data: data, ownerID: ownerID, group: groupTitle ?? (defaultGroup == "__generic__" ? "" : defaultGroup), groupID: groupID) }
            catch { message = error.localizedDescription }
        case .failure(let error): message = error.localizedDescription
        }
    }
}

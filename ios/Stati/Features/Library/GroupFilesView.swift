import SwiftUI

struct GroupFilesView: View {
    @Environment(AppStore.self) private var store
    let query: String
    @State private var rows: [APIRecord] = []
    @State private var legacyGroups: [String] = []
    @State private var groups: WorshipGroupsModel?
    @State private var selectedGroup = GroupSelection.allGroups
    @State private var managingGroups = false
    @State private var nextCursor = ""
    @State private var canUpload = false
    @State private var loading = false
    @State private var generation = 0
    @State private var message = ""
    @State private var preview: FilePreviewRequest?
    @State private var sharing = false
    @State private var removing: APIRecord?
    init(query: String) {
        self.query = query
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "group-delete" { _removing = State(initialValue: APIRecord(raw: NativeReviewMaterial.file.fields)) }
        if NativeReview.route == "group-share" { _sharing = State(initialValue: true) }
        #endif
    }
    private var selectedGroupID: String? { if case .named(let id) = selectedGroup { return id }; return nil }
    private var legacyGroup: String { if case .legacy(let label) = selectedGroup { return label }; return "" }
    private var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var matching: [APIRecord] { rows.filter { searchTerm.isEmpty || [$0.title, $0["groupName"].text, $0["filename"].text].contains(where: { $0.localizedStandardContains(searchTerm) }) } }
    var body: some View {
        List {
        Picker("Group", selection: $selectedGroup) {
            Text("All groups").tag(GroupSelection.allGroups)
            if let groups { Section("Worship groups") { ForEach(groups.groups) { Text($0.name).tag(GroupSelection.named($0.id)) } } }
            if !legacyGroups.isEmpty { Section("Folders") { ForEach(legacyGroups, id: \.self) { Text($0).tag(GroupSelection.legacy($0)) } } }
        }.foregroundStyle(Color.primary)
        if groups?.canCreate == true || groups?.groups.isEmpty == false { Button("Manage worship groups", systemImage: "person.2") { managingGroups = true } }
        if canUpload { Button("Share group file", systemImage: "plus") { sharing = true } }
        ForEach(matching) { row in
            VStack(alignment: .leading, spacing: 8) {
                Text(row.title).font(.headline)
                if selectedGroup == .allGroups { Text(row["groupName"].text).font(.subheadline).foregroundStyle(Color.statiSecondary) }
                if row["removalPending"].flag { Text("Removal pending").font(.footnote).foregroundStyle(Color.statiSecondary) }
                Text("Shared by " + row["authorName"].text).font(.footnote).foregroundStyle(Color.statiSecondary)
                HStack {
                    Button("Open", systemImage: "doc") { preview = FilePreviewRequest(record: row, pathKey: "fileUrl"); if preview == nil { message = "This file link is unavailable. Refresh shared files and try again." } }.disabled(row["removalPending"].flag)
                    Spacer()
                }.buttonStyle(.borderless)
            }.contentShape(.rect).contextMenu {
                Button("Open", systemImage: "doc") { preview = FilePreviewRequest(record: row, pathKey: "fileUrl") }
                if row["canDelete"].flag { Button("Delete", systemImage: "trash", role: .destructive) { removing = row } }
            }
        }
        if loading { ProgressView("Loading shared files…") }
        if !loading && matching.isEmpty { Text(query.isEmpty ? "No shared group files yet." : "No matches in the loaded files.").foregroundStyle(Color.statiSecondary) }
        if !nextCursor.isEmpty {
            Button("Load older files", systemImage: "arrow.down") { Task { await load(more: true) } }.disabled(loading)
            if !query.isEmpty { Text("Load older files to include them in your search.").font(.footnote).foregroundStyle(Color.statiSecondary) }
        }
        NoticeView(text: message)
        }
            .refreshable { await load() }
            .onChange(of: store.fileChangeRevision) { Task { await load() } }
            .task(id: store.groupChangeRevision) { if groups == nil { groups = WorshipGroupsModel(store: store) }; await groups?.load() }
            .onChange(of: groups?.revision) { Task { if let selectedGroupID, groups?.loaded == true, groups?.groups.contains(where: { $0.id == selectedGroupID }) == false { selectedGroup = .allGroups; preview = nil }; await load() } }
            .task(id: selectedGroup) { await load() }.fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
            .sheet(isPresented: $sharing) { ShareGroupFileView(initialGroupID: selectedGroupID) { Task { await load() } } }
            .sheet(isPresented: $managingGroups, onDismiss: { Task { await groups?.load(); await load() } }) { NavigationStack { if let groups { WorshipGroupsManagementView(store: store, groups: groups).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close groups", systemImage: "xmark") { managingGroups = false }.labelStyle(ActionIconLabelStyle()) } } } } }
            .confirmationDialog("Delete this group file?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                if let removing { Button("Delete file", role: .destructive) { Task { do { _ = try await store.api.request("/group-materials/" + removing.id, method: "DELETE"); store.recents.remove(id: "file::/api/group-materials/" + removing.id + "/file"); store.resources.clear(); store.filesChanged(); self.removing = nil; await load() } catch { message = error.localizedDescription } } } }
            } message: { Text("People with access to this group will lose access to this copy. Your original stays on your device.") }
    }
    private func load(more: Bool = false) async {
        guard !more || !loading && !nextCursor.isEmpty else { return }
        generation += 1; let scope = generation, group = selectedGroup, cursor = more ? nextCursor : "", epoch = store.accountEpoch, owner = store.me?.id
        loading = true; message = ""
        if !more { rows = []; nextCursor = ""; canUpload = false }
        defer { if scope == generation { loading = false } }
        do {
            let filter = selectedGroupID.map { "groupId=" + $0.queryEncoded } ?? "groupName=" + legacyGroup.queryEncoded
            let path = "/group-materials?" + filter + (cursor.isEmpty ? "" : "&before=" + cursor.queryEncoded)
            let result = try await store.api.request(path)
            guard scope == generation, group == selectedGroup, epoch == store.accountEpoch, owner == store.me?.id else { return }
            let page = result["materials"].records
            rows = more ? rows + page.filter { candidate in !rows.contains(where: { $0.id == candidate.id }) } : page
            legacyGroups = result["groups"].items.map(\.text); nextCursor = result["nextCursor"].text; canUpload = result["canUpload"].flag
        } catch is CancellationError { }
        catch { if scope == generation, epoch == store.accountEpoch, owner == store.me?.id { message = error.localizedDescription } }
    }
}

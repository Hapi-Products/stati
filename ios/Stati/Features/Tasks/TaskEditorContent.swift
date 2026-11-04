import SwiftUI
import PhotosUI
import UIKit

struct TaskEditorContent: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Bindable var editor: TaskEditor
    let removed: (APIRecord) -> Void
    var close: (() -> Void)?
    @State private var deleting = false
    @State private var reloadingSaved = false
    @State private var undoneNote: APIRecord?
    @State private var photos: [PhotosPickerItem] = []
    @State private var attaching = false
    @State private var pickingImages = false
    private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    @State private var preview: FilePreviewRequest?
    @State private var undoneImage: APIRecord?
    @State private var removingImage: APIRecord?
    @State private var openingImage: APIRecord?
    init(editor: TaskEditor, close: (() -> Void)? = nil, removed: @escaping (APIRecord) -> Void) {
        self.editor = editor; self.removed = removed; self.close = close
        #if DEBUG && targetEnvironment(simulator)
        
        if NativeReview.route == "task-image-remove" { _removingImage = State(initialValue: APIRecord(raw: NativeReviewTaskImage.record.fields)) }
        #endif
    }
    var body: some View {
        VStack(spacing: 0) {
        ScrollViewReader { proxy in
            Form {
                detailsSection
                imagesSection
                commentsSection.id("task-comments")
            }
            .contentMargins(.top, 8, for: .scrollContent)
            .listSectionSpacing(.compact)
            .scrollContentBackground(UIDevice.current.userInterfaceIdiom == .pad ? .hidden : .visible)
            .background(Color(.systemBackground))
            #if DEBUG && targetEnvironment(simulator)
            .task {
                if NativeReview.route == "task-image-open" || NativeReview.route == "task-gallery-open" { openingImage = editor.images.first }
                if NativeReview.route == "task-comments" {
                    try? await Task.sleep(for: .milliseconds(250))
                    proxy.scrollTo("task-comments", anchor: .top)
                }
            }
            #endif
        }
        }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .onChange(of: openingImage) { _, file in
            guard let file else { return }
            let items = editor.images.compactMap { FilePreviewItem(record: $0, pathKey: "url") }
            if let selected = FilePreviewItem(record: file, pathKey: "url") { preview = FilePreviewRequest(items: items, selectedID: selected.id) }
            if preview == nil { editor.message = "This image link is unavailable. Reopen the task and try again." }
            openingImage = nil
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if editor.task["canManage"].flag {
                    Button("Add images", systemImage: "photo.badge.plus") { pickingImages = true }
                        .labelStyle(ActionIconLabelStyle()).disabled(attaching || editor.images.count >= 6 || editor.submittingComment)
                    urgentButton
                }
                if editor.task["canDelete"].flag { taskMenu }
                if let close { Button("Close task", systemImage: "xmark", action: close).labelStyle(ActionIconLabelStyle()) }
            }
        }
        .photosPicker(isPresented: $pickingImages, selection: $photos, maxSelectionCount: max(1, 6 - editor.images.count), matching: .images)
        .confirmationDialog("Use the saved task?", isPresented: $reloadingSaved, titleVisibility: .visible) {
            Button("Use saved version", role: .destructive) { Task { await editor.reloadSavedVersion() } }
        } message: { Text("This replaces your unsaved title, details and status with the saved version. Your comment text stays here.") }
        .confirmationDialog("Delete this task?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete task", role: .destructive) { Task { await editor.save(); guard !editor.saving, !editor.failed else { return }; do { let result = try await store.api.request("/tasks", method: "POST", body: .object(["action": .string("delete"), "id": .string(editor.task.id), "revision": editor.task["revision"]])); editor.deleted = true; store.taskChanged(APIRecord(raw: result.fields)); removed(APIRecord(raw: result.fields)); dismiss() } catch { editor.message = error.localizedDescription } } }
        } message: { Text("You can undo its removal from the task board.") }
        .confirmationDialog("Remove this task image?", isPresented: Binding(get: { removingImage != nil }, set: { if !$0 { removingImage = nil } }), titleVisibility: .visible) {
            if let removingImage { Button("Remove image", role: .destructive) { Task { await removeImage(removingImage); self.removingImage = nil } } }
        } message: { Text("You can undo this removal from the task.") }
        .onChange(of: photos) { _, items in Task { await attach(items) } }
        .onDisappear { if !editor.failed && !editor.deleted { Task { await editor.save() } } }
    }
    private var urgentButton: some View {
        Button(editor.urgent ? "Remove urgent flag" : "Mark urgent", systemImage: editor.urgent ? "flag.fill" : "flag") { editor.urgent.toggle() }
            .labelStyle(ActionIconLabelStyle()).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44).disabled(editor.submittingComment)
    }
    private var taskMenu: some View {
        Menu("Task actions", systemImage: "ellipsis") { Button("Delete task", systemImage: "trash", role: .destructive) { deleting = true }.disabled(editor.saving || editor.submittingComment || attaching) }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
    }
    private var detailsSection: some View {
            Section {
                HStack(spacing: 10) {
                    MemberAvatar(api: store.api, path: editor.task["authorPhotoUrl"].text, initials: String(editor.task["authorName"].text.prefix(1)), size: 28).dynamicTypeSize(.large)
                    Text(editor.task["authorName"].text).font(.footnote.weight(.medium))
                }
                TextField("Title", text: $editor.title, prompt: Text("Title").foregroundStyle(Color.statiSecondary), axis: .vertical).lineLimit(1...4).font(.headline).disabled(!editor.task["canManage"].flag || editor.submittingComment)
                TextField("Details", text: $editor.body, prompt: Text("Details").foregroundStyle(Color.statiSecondary), axis: .vertical).lineLimit(1...8).disabled(!editor.task["canManage"].flag || editor.submittingComment)
                if editor.task["canManage"].flag {
                    HStack {
                        Picker("Status", selection: $editor.status) { Text("New").tag("new"); Text("In progress").tag("in-progress"); Text("Complete").tag("complete") }.pickerStyle(.menu)
                        Spacer()
                    }.disabled(editor.submittingComment)
                }
                if !editor.message.isEmpty && editor.message != "Saved" { NoticeView(text: editor.message) }
                if editor.remoteChanged { Button("Use saved version", systemImage: "arrow.counterclockwise") { reloadingSaved = true } }
                else if editor.failed { Button("Retry saving", systemImage: "arrow.clockwise") { Task { await editor.save() } } }
            }
    }
    @ViewBuilder private var imagesSection: some View {
            if !editor.images.isEmpty || undoneImage != nil || attaching {
                Section {
                    if !editor.images.isEmpty {
                        Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 16) {
                            ForEach(Array(stride(from: 0, to: editor.images.count, by: 2)), id: \.self) { start in
                                GridRow {
                                    ForEach(Array(editor.images[start..<min(start + 2, editor.images.count)])) { image in
                                        TaskImagePreview(file: image, compact: editor.images.count > 1, open: { openingImage = image }, remove: { removingImage = image }).disabled(attaching)
                                    }
                                    if editor.images.count > 1 && start + 1 == editor.images.count { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                                }
                            }
                        }.padding(.vertical, 4)
                    }
                    if let undoneImage { Button("Undo image removal", systemImage: "arrow.uturn.backward") { Task { do { let result = try await store.api.request("/tasks/" + editor.task.id + "/images/" + undoneImage.id, method: "POST", body: .object([:])); editor.images = result["images"].records; self.undoneImage = nil } catch { editor.message = error.localizedDescription } } } }
                    if attaching { ProgressView("Saving images…") }
                } header: { SectionHeading("Images · \(editor.images.count)") }
            }
    }
    private var commentsSection: some View {
            Section {
                ForEach(editor.notes) { note in
                    TaskCommentRow(note: note) { Task { if await editor.removeNote(note) { undoneNote = note } } }.disabled(editor.submittingComment)
                }
                if let undoneNote { Button("Undo comment removal", systemImage: "arrow.uturn.backward") { Task { if await editor.removeNote(undoneNote, restoring: true) { self.undoneNote = nil } } } }
                HStack(alignment: .bottom) {
                    TextField("Add a comment", text: $editor.comment, prompt: Text("Add a comment").foregroundStyle(Color.statiSecondary), axis: .vertical).lineLimit(1...5).onChange(of: editor.comment) { editor.cache() }
                    Button(editor.hasPendingComment ? "Retry previous comment" : "Send comment", systemImage: "paperplane.fill") { Task { await editor.note() } }
                        .labelStyle(ActionIconLabelStyle()).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
                        .disabled((editor.comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !editor.hasPendingComment) || editor.saving || editor.submittingComment)
                }
                if editor.submittingComment { ProgressView("Sending comment…") }
                else if editor.hasPendingComment { Text("Retry sends the previous saved comment first. New text stays here.").font(.footnote).foregroundStyle(Color.statiSecondary) }
            } header: { SectionHeading("Comments · \(editor.notes.count)") }
    }
    private func removeImage(_ image: APIRecord) async {
        guard editor.isCurrentAccount else { return }
        do { let result = try await store.api.request("/tasks/" + editor.task.id + "/images/" + image.id, method: "DELETE"); guard editor.isCurrentAccount else { return }; editor.images = result["images"].records; undoneImage = image }
        catch { editor.message = error.localizedDescription }
    }
    private func attach(_ items: [PhotosPickerItem]) async {
        guard editor.isCurrentAccount, !attaching else { return }
        attaching = true; defer { attaching = false; photos = [] }
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let url = try await UploadFiles.photo(data: data); defer { try? FileManager.default.removeItem(at: url) }
                guard editor.isCurrentAccount else { return }
                let bytes = try Data(contentsOf: url)
                guard bytes.count <= 8 * 1024 * 1024 else { throw APIError(status: 413, message: "Choose an image up to 8 MB.") }
                let id = UUID().uuidString.lowercased(), path = "/tasks/" + editor.task.id + "/images/" + id
                do { _ = try await store.api.bytes(path, method: "PUT", body: bytes, headers: ["X-Filename": "photo.jpg", "Content-Type": "image/jpeg", "Content-Length": String(bytes.count)]) }
                catch { guard editor.isCurrentAccount else { return }; let current = try await store.api.request("/tasks/" + editor.task.id + "/images"); guard editor.isCurrentAccount else { return }; editor.images = current["images"].records; if !editor.images.contains(where: { $0.id == id }) { throw error } }
                let saved = try await store.api.request("/tasks/" + editor.task.id + "/images")["images"].records
                guard editor.isCurrentAccount else { return }; editor.images = saved
            } catch { editor.message = error.localizedDescription; return }
        }
    }
}

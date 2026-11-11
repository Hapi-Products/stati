import SwiftUI

struct SongTextComposer: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let preparing: Bool
    let message: String
    let add: () async -> Bool
    var onlineQuery = ""
    var opensOnlineSearch = false
    var dismissesAfterAdding = true
    @AppStorage("stati.hymnSearch.enabled") private var onlineEnabled = true
    @State private var finding = false
    @State private var pendingImport: SendDraft?
    @State private var saving = false

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                if onlineEnabled { Button("Find hymns online", systemImage: "globe") { finding = true } }
                TextField("Song title", text: $store.sendDraft.title, prompt: Text("Song title").foregroundStyle(Color.statiSecondary))
                TextEditor(text: $store.sendDraft.text).frame(minHeight: 180).accessibilityLabel("Song text")
                if saving { ProgressView("Adding song text…") }
                if !message.isEmpty { NoticeView(text: message) }
                if !store.uploads.message.isEmpty { NoticeView(text: store.uploads.message) }
            }.contentMargins(.top, 8, for: .scrollContent).navigationTitle("Song Text").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add", systemImage: "checkmark") { Task { saving = true; defer { saving = false }; if await add(), dismissesAfterAdding { dismiss() } } }.labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                            .disabled(saving || preparing || store.uploads.busy || store.uploads.availableSlots == 0 || store.sendDraft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.selectedComputer.isEmpty)
                    }
                }
                .sheet(isPresented: $finding) {
                    SongOnlineSearch(initialQuery: onlineQuery) { draft in
                        finding = false
                        if store.sendDraft == SendDraft() { store.sendDraft = draft }
                        else { pendingImport = draft }
                    }
                }
                .confirmationDialog("Replace the current song draft?", isPresented: Binding(
                    get: { pendingImport != nil }, set: { if !$0 { pendingImport = nil } }
                ), titleVisibility: .visible) {
                    Button("Replace draft", role: .destructive) {
                        if let pendingImport { store.sendDraft = pendingImport }
                        pendingImport = nil
                    }
                }
                .task { if onlineEnabled && opensOnlineSearch { finding = true } }
                .onChange(of: onlineEnabled) { _, enabled in if !enabled { finding = false } }
                .interactiveDismissDisabled(saving)
        }
    }
}

struct SongSubmissionEditor: View {
    var onlineQuery = ""
    var opensOnlineSearch = false
    var showsQueueAfterAdding = false
    var queued: () -> Void = {}
    @Environment(AppStore.self) private var store
    @State private var message = ""
    @State private var sending = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SongTextComposer(preparing: false, message: message, add: queue, onlineQuery: onlineQuery, opensOnlineSearch: opensOnlineSearch, dismissesAfterAdding: !showsQueueAfterAdding)
            .sheet(isPresented: $sending, onDismiss: { dismiss() }) {
                NavigationStack { SendView(active: true) }
            }
    }

    private func queue() async -> Bool {
        guard let owner = store.me?.id, !store.selectedComputer.isEmpty else { return false }
        let draft = store.sendDraft, computer = store.selectedComputer, epoch = store.accountEpoch
        do {
            try await FileStager.stage(count: 1, queue: store.uploads) { _ in
                try await UploadFiles.prepareSongText(draft, userID: owner, deviceID: computer)
            }
            guard store.accountEpoch == epoch else { return false }
            if store.sendDraft == draft { store.sendDraft = SendDraft() }
            if showsQueueAfterAdding { sending = true }
            queued()
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }
}

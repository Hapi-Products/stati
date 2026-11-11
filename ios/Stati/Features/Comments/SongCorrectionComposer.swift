import SwiftUI
import PhotosUI

struct SongCorrectionComposer: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: SongCorrectionModel
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var selecting: SongCorrectionEdit?
    init(store: AppStore, computerID: String, song: APIRecord) {
        #if DEBUG && targetEnvironment(simulator)
        if ["commenter-compose", "commenter-corrections", "commenter-selection"].contains(NativeReview.route ?? "") {
            let model = SongCorrectionModel(store: store, computerID: computerID, song: song, storageRoot: URL.temporaryDirectory.appending(path: UUID().uuidString))
            model.comment = "Please check these two passages."
            let source = song["text"].text as NSString
            model.selectPassage(source.range(of: "sweet the sound")); model.selectPassage(source.range(of: "grace will lead me home"))
            if let first = model.draft.edits.first { model.replacePassage(first.id, with: "sweet the sound") }
            _model = State(initialValue: model)
        } else { _model = State(initialValue: SongCorrectionModel(store: store, computerID: computerID, song: song)) }
        #else
        _model = State(initialValue: SongCorrectionModel(store: store, computerID: computerID, song: song))
        #endif
    }
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            Form {
                Section {
                    SongCorrectionLyrics(text: model.draft.song["text"].text) { model.selectPassage($0) }
                } footer: { Text("Double-tap a word, then drag the handles to select a passage.") }
                ForEach(model.draft.edits) { edit in
                    SongCorrectionPassageCard(edit: edit, editable: model.editable, changeSelection: { selecting = edit }, remove: { model.removePassage(edit.id) }, replacement: Binding(get: { model.draft.edits.first(where: { $0.id == edit.id })?.replacement ?? "" }, set: { model.replacePassage(edit.id, with: $0) })).id(edit.id)
                }
                if model.draft.edits.isEmpty && !model.draft.quote.isEmpty {
                    Section("Selected lyrics") {
                        HStack(alignment: .top) {
                            Text(model.draft.quote).textSelection(.enabled)
                            Spacer(minLength: 8)
                            if model.editable { Button("Clear selection", systemImage: "xmark") { model.quote = "" }.labelStyle(ActionIconLabelStyle()).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44) }
                        }
                        RomanianCorrectionField(text: $model.replacement, editable: model.editable)
                    }
                }
                if !model.draft.images.isEmpty { images }
                if !model.message.isEmpty { Section { NoticeView(text: model.message) } }
                if model.busy { Section { ProgressView("Sending comment…") } }
            }
            .onChange(of: model.draft.edits.map(\.id)) { previous, current in
                if let new = current.first(where: { !previous.contains($0) }) {
                    proxy.scrollTo(new, anchor: .center)
                }
            }
            .navigationTitle(model.draft.song.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close comment", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(model.busy) }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if [.sent,.rejected].contains(model.draft.phase) { Button("New comment", systemImage: "square.and.pencil") { model.startNew() }.labelStyle(ActionIconLabelStyle()).disabled(model.busy) }
                        else {
                            Button("Add images", systemImage: "photo.badge.plus") { pickingPhotos = true }.labelStyle(ActionIconLabelStyle()).disabled(!model.editable || model.draft.images.count >= 6)
                            Button(model.draft.phase == .editing ? "Send selected lyrics" : "Retry saved correction", systemImage: "arrow.up") { Task { await model.send() } }.labelStyle(ActionIconLabelStyle()).buttonStyle(.borderedProminent).disabled(!model.canSend)
                        }
                    }
                }
                #if DEBUG && targetEnvironment(simulator)
                .task { if NativeReview.route == "commenter-corrections", let id = model.draft.edits.first?.id { try? await Task.sleep(for: .milliseconds(400)); proxy.scrollTo(id, anchor: .top) } }
                #endif
            }
        }
        .sheet(item: $selecting) { edit in SongCorrectionSelectionEditor(source: model.draft.song["text"].text, edit: edit) { model.selectPassage($0, editing: edit.id) } }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: max(1, 6 - model.draft.images.count), matching: .images)
        .onChange(of: photos) { _, chosen in Task { for photo in chosen { do { if let bytes = try await photo.loadTransferable(type: Data.self) { await model.addImage(bytes) } else { model.photoFailed() } } catch { model.photoFailed() } }; photos = [] } }
        .task {
            await model.reconcile()
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "commenter-selection" { selecting = model.draft.edits.first }
            #endif
        }
        .interactiveDismissDisabled(model.busy)
    }
    private var images: some View {
        Section("Images") {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(model.draft.images) { image in
                    VStack(spacing: 6) {
                        if let url = model.imageURL(image), let photo = UIImage(contentsOfFile: url.path) { Image(uiImage: photo).resizable().scaledToFit().frame(maxHeight: 180).accessibilityLabel("Attached image") }
                        if model.editable { Button("Remove image", systemImage: "trash", role: .destructive) { model.removeImage(image.id) }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44) }
                    }
                }
            }
        }
    }
}

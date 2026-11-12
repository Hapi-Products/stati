import SwiftUI

struct SongGalleryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    private let openingRequest: SongGalleryRequest
    private let selectionChanged: (String) -> Void
    @State private var model: SongGalleryModel
    @State private var preferences: ReaderPreferences
    @Environment(\.scenePhase) private var scenePhase
    @State private var modeOverride: SongReaderMode?
    @State private var showingReaderHelp = false
    private var readerMode: SongReaderMode { modeOverride ?? preferences.settings.mode }
    @State private var preview: FilePreviewRequest?
    @State private var linking = false
    @State private var unlinking: APIRecord?
    @State private var unlinkBusy = false
    @State private var commenting = false
    @State private var exportError = ""
    @State private var focused = false
    @State private var choosingSong = false
    @State private var exporting = false
    @State private var shareAnchor = SongReaderShareAnchor()
    @ScaledMetric(relativeTo: .body) private var actionSize = 20.0
    private var actionSymbolSize: CGFloat { iPad ? 20 : actionSize }
    private var actionTarget: CGFloat { iPad ? 44 : max(44, actionSize * 1.2 + 20) }
    init(store: AppStore, request: SongGalleryRequest, selectionChanged: @escaping (String) -> Void = { _ in }) {
        openingRequest = request
        self.selectionChanged = selectionChanged
        _model = State(initialValue: SongGalleryModel(store: store, request: request))
        _preferences = State(initialValue: ReaderPreferences(ownerID: store.me?.id ?? ""))
    }
    private var iPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    var body: some View {
        NavigationStack { reader }
        .preferredColorScheme(iPad && readerMode == .document ? .light : iPad && readerMode == .slides ? .dark : nil)
        .task {
            if model.song == nil { await model.load() }
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "reader-document-switch" {
                try? await Task.sleep(for: .seconds(1))
                modeOverride = .slides
            }
            if NativeReview.route == "ipad-service-selector" {
                preferences.settings.selectorSource = .currentService
                choosingSong = true
            }
            if NativeReview.route == "ipad-service-share", let song = model.song {
                await prepareExport(song, kind: .slidePDF)
            }
            #endif
        }
        #if DEBUG && targetEnvironment(simulator)
        .onChange(of: model.files) { if NativeReview.route == "reader-unlink" { unlinking = model.files.first(where: { $0["canDelete"].flag }) } }
        #endif
        .onChange(of: model.selected.id) {
            if model.request.isService, openingRequest.isService, openingRequest.items.contains(where: { $0.id == model.selected.id }) {
                selectionChanged(model.selected.id)
            }
        }
        .sheet(isPresented: $showingReaderHelp) { WorshipHelpView(topic: .reader) }
        .onChange(of: scenePhase) { _, phase in if phase == .active { preferences.reload(); modeOverride = nil } }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onChange(of: store.selectedComputer) { dismiss() }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .sheet(isPresented: $choosingSong) {
            WorshipReaderSongsView(computerID: model.request.computerID, source: preferences.settings.selectorSource, selected: model.selected) { request in
                choosingSong = false
                if request.items.map(\.id) == model.request.items.map(\.id), request.isService == model.request.isService {
                    if request.position.index == model.position.index { return }
                    model.selectSong(request.items[request.position.index].id)
                } else {
                    model = SongGalleryModel(store: store, request: request)
                }
                Task { await model.load() }
            }
        }
        .sheet(isPresented: $commenting) { if !iPad, let song = model.song { SongCorrectionComposer(store: store, computerID: model.request.computerID, song: song) } }
        .sheet(isPresented: $linking) { LinkSongFileView(computerID: model.request.computerID, songID: model.selected.songID, linkedIDs: Set(model.files.map(\.id))) { linking = false; Task { await model.load() } } }
        .confirmationDialog("Unlink this file from the song?", isPresented: Binding(get: { unlinking != nil }, set: { if !$0 { unlinking = nil } }), titleVisibility: .visible) {
            if let file = unlinking { Button("Unlink file", role: .destructive) { unlinking = nil; Task { await unlink(file) } } }
        } message: { Text("The shared group file stays available. Only this song’s link is removed.") }
        .alert("Song action unavailable", isPresented: Binding(get: { !exportError.isEmpty }, set: { if !$0 { exportError = "" } })) { Button("OK", role: .cancel) { exportError = "" } } message: { Text(exportError) }
    }
    private var reader: some View {
    VStack(spacing: 0) {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReaderReview.active { Text("Sample data · Simulator review").font(.caption).dynamicTypeSize(.large).foregroundStyle(Color.statiSecondary).padding(8) }
        #endif
        if let song = model.song {
            SongReaderContent(song: song, mode: iPad ? readerMode : .text, transition: preferences.settings.transition, clickerEnabled: preferences.settings.clickerAllowed(onIPad: iPad), pdfColumns: preferences.settings.pdfColumns, slideSize: preferences.settings.slideSize, showsPagingControls: !focused).id(song.id + song["contentHash"].text)
        } else if model.loading { ProgressView("Opening song…").frame(maxWidth: .infinity, maxHeight: .infinity) }
        else { ContentUnavailableView("Song unavailable", systemImage: "music.note", description: Text(model.message)) }
        if !model.message.isEmpty, model.song != nil { NoticeView(text: model.message).padding(.horizontal, 16) }
        if model.song == nil && !model.loading { Button("Try again", systemImage: "arrow.clockwise") { Task { await model.load() } }.padding() }
    }.background(iPad && readerMode == .document ? Color.white.ignoresSafeArea() : iPad && readerMode == .slides ? Color.black.ignoresSafeArea() : Color(.systemBackground).ignoresSafeArea()).safeAreaInset(edge: .bottom) { if !iPad, let song = model.song { phoneActions(song) } }
        .overlay(alignment: .topTrailing) {
            if iPad { SongReaderShareSource(anchor: shareAnchor).frame(width: 1, height: 1).padding(.trailing, 40).allowsHitTesting(false).accessibilityHidden(true) }
        }
        .navigationTitle(model.song?.title ?? model.selected.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(focused ? .hidden : .visible, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            if focused {
                HStack {
                    Spacer()
                    Button("Show reader controls", systemImage: "arrow.down.right.and.arrow.up.left") { focused = false }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .controlSize(.large)
                }
                .padding([.horizontal, .bottom], 12)
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle())
            }
            if iPad {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Song Selector", systemImage: "music.note.list") {
                        preferences.reload()
                        choosingSong = true
                    }.labelStyle(.iconOnly)
                }
            }
            if iPad, let song = model.song {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Reader tips", systemImage: "lightbulb") { showingReaderHelp = true }
                        Picker("Song view", selection: Binding(get: { readerMode }, set: { modeOverride = $0 })) { ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) } }
                        Button("Focus on song", systemImage: "arrow.up.left.and.arrow.down.right") { focused = true }
                        Menu("Notes", systemImage: "note.text") { notesActions }
                        Menu("Share", systemImage: "square.and.arrow.up") {
                            ForEach(SongExportKind.allCases) { kind in
                                Button(kind.title, systemImage: kind.symbol) { Task { await prepareExport(song, kind: kind) } }
                            }
                            Button("Copy text", systemImage: "doc.on.doc") { UIPasteboard.general.string = song["text"].text }
                        }.disabled(exporting)
                    } label: { actionIcon("ellipsis") }.accessibilityLabel("Reader options")
                }
            }
        }
    }
    private var notesMenu: some View {
        Menu { notesActions } label: { actionIcon("note.text") }.accessibilityLabel("Song notes")
    }
    @ViewBuilder private var notesActions: some View {
        ForEach(model.files) { file in Button(file.title, systemImage: "doc.text") { preview = FilePreviewRequest(record: file, pathKey: "fileUrl") }.disabled(file["removalPending"].flag) }
        if model.files.isEmpty { Text("No linked notes") }
        if store.canPlan {
            let removable = model.files.filter { $0["canDelete"].flag && !$0["removalPending"].flag }
            if !removable.isEmpty { Menu("Unlink file", systemImage: "link.badge.minus") { ForEach(removable) { file in Button(file.title, role: .destructive) { unlinking = file } } }.disabled(unlinkBusy) }
        }
        if store.canPlan { Button("Link shared notes", systemImage: "link") { linking = true } }
    }
    private func unlink(_ file: APIRecord) async {
        guard !unlinkBusy, store.canPlan else { return }
        unlinkBusy = true; defer { unlinkBusy = false }
        do { try await model.unlink(file) } catch { exportError = error.localizedDescription }
    }
    private func actionIcon(_ symbol: String) -> some View {
        Image(systemName: symbol).resizable().scaledToFit().fontWeight(.regular).frame(width: actionSymbolSize, height: actionSymbolSize).foregroundStyle(AppIconAppearance.shared.accent).frame(width: actionTarget, height: actionTarget)
    }
    private func share(_ song: APIRecord) -> some View {
        SongShareButton(text: song["text"].text, prepare: { kind in try await SongExportFiles.prepare(song: song, computerID: model.request.computerID, kind: kind, store: store) }, failure: { exportError = $0 }).frame(width: actionTarget, height: actionTarget)
    }
    private func prepareExport(_ song: APIRecord, kind: SongExportKind) async {
        guard !exporting else { return }
        exporting = true
        defer { exporting = false }
        let epoch = store.accountEpoch, computerID = model.request.computerID
        do {
            let file = try await SongExportFiles.prepare(song: song, computerID: computerID, kind: kind, store: store)
            guard !Task.isCancelled, epoch == store.accountEpoch else { SongExportFiles.remove(file); return }
            SongShareButton.present(file, from: shareAnchor.view)
        } catch is CancellationError { }
        catch { exportError = error.localizedDescription }
    }
    private func phoneActions(_ song: APIRecord) -> some View {
        HStack(spacing: 20) {
            if store.canCommentSongs { Button { commenting = true } label: { actionIcon("text.bubble") }.accessibilityLabel("Comment") }
            share(song)
            notesMenu
        }.font(.system(size: 20, weight: .regular)).buttonStyle(.plain).padding(.horizontal, 12).padding(.vertical, 4).glassEffect(.regular, in: .capsule).padding(.bottom, 8)
    }

}


private final class SongReaderShareAnchor {
    weak var view: UIView?
}

private struct SongReaderShareSource: UIViewRepresentable {
    let anchor: SongReaderShareAnchor

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        anchor.view = view
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

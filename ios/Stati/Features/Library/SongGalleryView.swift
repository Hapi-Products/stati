import SwiftUI

struct SongGalleryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    @Environment(\.worshipLiveContext) private var live
    private let openingRequest: SongGalleryRequest
    private let selectionChanged: (String) -> Void
    @State private var model: SongGalleryModel
    @State private var preferences: ReaderPreferences
    @Environment(\.scenePhase) private var scenePhase
    @State private var modeOverride: SongReaderMode?
    @State private var guide = WorshipGuide()
    private var readerMode: SongReaderMode { modeOverride ?? preferences.settings.mode }
    @State private var preview: FilePreviewRequest?
    @State private var linking = false
    @State private var unlinking: APIRecord?
    @State private var unlinkBusy = false
    @State private var commenting = false
    @State private var exportError = ""
    @State private var focused = false
    @State private var pageIndex = 0
    @State private var livePageCount = 0
    @State private var pageCountScope = ""
    @State private var leadPosition: LiveWorshipReader.Position?
    @State private var didFollow = false

    private var following: Bool {
        guard let live, live.reader.following, model.request.isService,
              let position = live.reader.position else { return false }
        return model.request.items.contains { $0.id == position.item }
    }
    private var livePosition: LiveWorshipReader.Position? {
        guard model.request.isService else { return nil }
        let settings = preferences.settings
        var position = LiveWorshipReader.Position(item: model.selected.id, page: pageIndex, mode: readerMode,
                                                  transition: settings.transition, columns: settings.pdfColumns, size: settings.slideSize)
        if pageCountScope == readerPageScope, readerMode != .text, (0..<livePageCount).contains(pageIndex), livePageCount <= 10_001 {
            position.pageCount = livePageCount
        }
        return position
    }
    private var readerPageScope: String { model.selected.id + readerMode.rawValue + String(preferences.settings.pdfColumns.rawValue) }

    @State private var shortcutNavigation = SongShortcutNavigation.shared
    @State private var shortcutReaderID = UUID()
    @State private var songToPlace: APIRecord?
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
        .preferredColorScheme(iPad && readerMode == .slides ? .dark : nil)
        .task {
            if model.song == nil { await model.load() }
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "reader-place-song" {
                _ = try? await PlaceStatiSongInService().perform()
            }
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
            if !following { pageIndex = 0 }
            if model.request.isService, openingRequest.isService, openingRequest.items.contains(where: { $0.id == model.selected.id }) {
                selectionChanged(model.selected.id)
            }
        }

        .onAppear {
            shortcutNavigation.readerID = shortcutReaderID
            followLivePage()
        }
        .onChange(of: live?.reader.position) { followLivePage() }
        .onChange(of: live?.reader.clickerTurn) { _, turn in
            guard live?.reader.leading == true, let position = turn?.position, position.item == model.selected.id,
                  position.mode == readerMode, position.pageCount == livePosition?.pageCount else { return }
            pageIndex = position.page
        }
        .onChange(of: livePosition) {
            guard let live, let position = livePosition, !following else { return }
            guard live.items.contains(where: { $0.id == position.item }) else { return }
            live.reader.update(position, store: store)
        }
        .onChange(of: model.song?.id, initial: true) {
            guard iPad, model.song != nil, let live, let position = livePosition,
                  live.items.contains(where: { $0.id == position.item }), live.shouldOffer() else { return }
            leadPosition = position
        }
        .alert("Start leading this service?", isPresented: Binding(get: { leadPosition != nil }, set: { if !$0 { leadPosition = nil } })) {
            Button("No", role: .cancel) { leadPosition = nil }
            Button("Yes, Lead") { if let position = livePosition { live?.lead(position) }; leadPosition = nil }
        } message: {
            Text("Tablets in your worship group will follow your song and page turns.")
        }
        .onDisappear {
            if shortcutNavigation.readerID == shortcutReaderID { shortcutNavigation.readerID = nil }
            if model.request.isService, live?.reader.leading == true { live?.reader.readerClosed(store: store) }
        }
        .onChange(of: shortcutNavigation.placementReaderID) { _, readerID in
            guard readerID == shortcutReaderID else { return }
            shortcutNavigation.placementReaderID = nil
            guard store.canPlan, let song = model.song else {
                exportError = "Open a library song using an account that can plan services."
                return
            }
            songToPlace = song
        }
        .sheet(item: $songToPlace) { song in
            AddSongToService(computerID: model.request.computerID, song: song) { songToPlace = nil }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { preferences.reload(); if !following { modeOverride = nil } } }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onChange(of: store.selectedComputer) { dismiss() }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .sheet(isPresented: $choosingSong) {
            WorshipReaderSongsView(computerID: model.request.computerID, source: preferences.settings.selectorSource, selected: model.selected) { request in
                choosingSong = false
                if request.items.map(\.id) == model.request.items.map(\.id), request.isService == model.request.isService {
                    if request.position.index == model.position.index { return }
                    pageIndex = 0
                    model.selectSong(request.items[request.position.index].id)
                } else {
                    pageIndex = 0
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
            let synced = following ? live?.reader.position : nil
            let pageScope = readerPageScope
            SongReaderContent(song: song, mode: iPad ? readerMode : .text,
                              transition: synced?.transition ?? preferences.settings.transition,
                              clickerEnabled: preferences.settings.clickerAllowed(onIPad: iPad),
                              pdfColumns: synced?.columns ?? preferences.settings.pdfColumns,
                              slideSize: synced?.size ?? preferences.settings.slideSize,
                              showsPagingControls: !focused, guide: iPad ? guide : nil,
                              pageIndex: $pageIndex, followsLeader: following, pageCountChanged: { count in
                                  pageCountScope = pageScope
                                  livePageCount = count
                              }).id(song.id + song["contentHash"].text + pageScope)
        } else if model.loading { ProgressView("Opening song…").frame(maxWidth: .infinity, maxHeight: .infinity) }
        else { ContentUnavailableView("Song unavailable", systemImage: "music.note", description: Text(model.message)) }
        if !model.message.isEmpty, model.song != nil { NoticeView(text: model.message).padding(.horizontal, 16) }
        if model.song == nil && !model.loading { Button("Try again", systemImage: "arrow.clockwise") { Task { await model.load() } }.padding() }
    }.background(iPad && readerMode == .slides ? Color.black.ignoresSafeArea() : Color(.systemBackground).ignoresSafeArea()).safeAreaInset(edge: .bottom) { if !iPad, let song = model.song { phoneActions(song) } }
        .overlay(alignment: .topTrailing) {
            if iPad { SongReaderShareSource(anchor: shareAnchor).frame(width: 1, height: 1).padding(.trailing, 40).allowsHitTesting(false).accessibilityHidden(true) }
        }
        .worshipGuide(iPad ? guide : nil, at: .fallback)
        .navigationTitle(model.song?.title ?? model.selected.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(focused ? .hidden : .visible, for: .navigationBar)
        .overlay(alignment: .bottomTrailing) {
            if iPad && model.song != nil {
                Button(focused ? "Show reader controls" : "Focus on song",
                       systemImage: focused ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                    guide.stop()
                    focused.toggle()
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .tint(AppIconAppearance.shared.accent)
                .controlSize(.large)
                .worshipGuide(guide, at: .focus)
                .padding([.trailing, .bottom], 12)
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
                        guide.stop()
                        choosingSong = true
                    }
                    .labelStyle(.iconOnly)
                    .worshipGuide(guide, at: .songSelector)
                    .disabled(following)
                }
            }
            if iPad, let song = model.song {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if store.canPlan {
                        Button("Link shared notes", systemImage: "link") {
                            guide.stop()
                            linking = true
                        }
                        .labelStyle(.iconOnly)
                        .worshipGuide(guide, at: .linkNotes)
                    }
                    Button("Song controls help", systemImage: "questionmark.circle") {
                        let hasPages = readerMode == .document || (readerMode == .slides && SongPages(text: song["text"].text).slides.count > 1)
                        guide.start(.reader(hasPages: hasPages, following: following, canLink: store.canPlan))
                    }.labelStyle(.iconOnly)
                    Menu {
                        Picker("Song view", selection: Binding(get: { readerMode }, set: { modeOverride = $0; pageIndex = 0 })) { ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) } }.disabled(following)
                        Menu("Notes", systemImage: "note.text") { notesActions }
                        if store.canPlan {
                            Button("Add to service", systemImage: "text.badge.plus") { songToPlace = song }
                        }
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
    private func followLivePage() {
        guard let position = live?.reader.position, following else {
            if didFollow { didFollow = false; modeOverride = nil; pageIndex = 0 }
            return
        }
        didFollow = true
        modeOverride = position.mode
        pageIndex = position.page
        if model.selected.id != position.item, model.request.items.contains(where: { $0.id == position.item }) {
            model.selectSong(position.item)
            Task { await model.load() }
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
        if !iPad && store.canPlan { Button("Link shared notes", systemImage: "link") { linking = true } }
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

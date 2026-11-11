import SwiftUI

struct SongGalleryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppStore.self) private var store
    private let openLibrary: (() -> Void)?
    private let selectionChanged: (String) -> Void
    @State private var model: SongGalleryModel
    @State private var preferences: ReaderPreferences
    @State private var preview: FilePreviewRequest?
    @State private var linking = false
    @State private var unlinking: APIRecord?
    @State private var unlinkBusy = false
    @State private var commenting = false
    @State private var exportError = ""
    @State private var focused = false
    @State private var choosingSong = false
    @ScaledMetric(relativeTo: .body) private var actionSize = 20.0
    private var actionSymbolSize: CGFloat { iPad ? 20 : actionSize }
    private var actionTarget: CGFloat { iPad ? 44 : max(44, actionSize * 1.2 + 20) }
    init(store: AppStore, request: SongGalleryRequest, openLibrary: (() -> Void)? = nil, selectionChanged: @escaping (String) -> Void = { _ in }) {
        self.openLibrary = openLibrary
        self.selectionChanged = selectionChanged
        _model = State(initialValue: SongGalleryModel(store: store, request: request))
        _preferences = State(initialValue: ReaderPreferences(ownerID: store.me?.id ?? ""))
    }
    private var iPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    var body: some View {
        Group {
            if openLibrary != nil { reader }
            else { NavigationStack { reader } }
        }
        .preferredColorScheme(iPad && preferences.settings.mode == .document ? .light : iPad && preferences.settings.mode == .slides ? .dark : nil)
        .task {
            if model.song == nil { await model.load() }
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "reader-document-switch" {
                try? await Task.sleep(for: .seconds(1))
                preferences.settings.mode = .slides
            }
            #endif
        }
        #if DEBUG && targetEnvironment(simulator)
        .onChange(of: model.files) { if NativeReview.route == "reader-unlink" { unlinking = model.files.first(where: { $0["canDelete"].flag }) } }
        #endif
        .onChange(of: model.position.index) { selectionChanged(model.selected.id) }
        .onChange(of: store.accountEpoch) { if openLibrary == nil { dismiss() } }
        .onChange(of: store.selectedComputer) { if openLibrary == nil { dismiss() } }
        .fullScreenCover(item: $preview) { StatiFileViewer(request: $0) }
        .sheet(isPresented: $choosingSong) {
            WorshipReaderSongsView(
                items: model.request.items,
                selectedID: model.selected.id,
                isService: model.request.isService
            ) { id in
                model.selectSong(id)
                choosingSong = false
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
            SongReaderContent(song: song, mode: iPad ? preferences.settings.mode : .text, transition: preferences.settings.transition, clickerEnabled: preferences.settings.clickerAllowed(onIPad: iPad), pdfColumns: preferences.settings.pdfColumns, slideSize: preferences.settings.slideSize, showsPagingControls: !focused).id(song.id + song["contentHash"].text)
        } else if model.loading { ProgressView("Opening song…").frame(maxWidth: .infinity, maxHeight: .infinity) }
        else { ContentUnavailableView("Song unavailable", systemImage: "music.note", description: Text(model.message)) }
        if !model.message.isEmpty, model.song != nil { NoticeView(text: model.message).padding(.horizontal, 16) }
        if model.song == nil && !model.loading { Button("Try again", systemImage: "arrow.clockwise") { Task { await model.load() } }.padding() }
    }.background(iPad && preferences.settings.mode == .document ? Color.white.ignoresSafeArea() : iPad && preferences.settings.mode == .slides ? Color.black.ignoresSafeArea() : Color(.systemBackground).ignoresSafeArea()).safeAreaInset(edge: .bottom) { if !iPad, let song = model.song { phoneActions(song) } }
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
            if openLibrary == nil {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle())
                }
            }
            if let openLibrary {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Library", systemImage: "books.vertical", action: openLibrary).labelStyle(ActionIconLabelStyle())
                }
            } else if iPad, model.request.items.count > 1 {
                ToolbarItem(placement: .topBarLeading) {
                    Button(model.request.isService ? "Running order" : "Songs", systemImage: model.request.isService ? "list.number" : "music.note.list") {
                        choosingSong = true
                    }
                    .labelStyle(ActionIconLabelStyle())
                }
            }
            if iPad, let song = model.song {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    notesMenu
                    Menu {
                        Picker("Song view", selection: $preferences.settings.mode) { ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) } }
                        Button("Focus on song", systemImage: "arrow.up.left.and.arrow.down.right") { focused = true }
                    } label: { actionIcon("ellipsis") }.accessibilityLabel("Reader options")
                    share(song)
                }
            }
        }
    }
    private var notesMenu: some View {
        Menu {
            ForEach(model.files) { file in Button(file.title, systemImage: "doc.text") { preview = FilePreviewRequest(record: file, pathKey: "fileUrl") }.disabled(file["removalPending"].flag) }
            if model.files.isEmpty { Text("No linked notes") }
            if store.canPlan {
                let removable = model.files.filter { $0["canDelete"].flag && !$0["removalPending"].flag }
                if !removable.isEmpty { Menu("Unlink file", systemImage: "link.badge.minus") { ForEach(removable) { file in Button(file.title, role: .destructive) { unlinking = file } } }.disabled(unlinkBusy) }
            }
            if store.canPlan { Button("Link shared notes", systemImage: "link") { linking = true } }
        } label: { actionIcon("note.text") }.accessibilityLabel("Song notes")
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
    private func phoneActions(_ song: APIRecord) -> some View {
        HStack(spacing: 20) {
            if store.canCommentSongs { Button { commenting = true } label: { actionIcon("text.bubble") }.accessibilityLabel("Comment") }
            share(song)
            notesMenu
        }.font(.system(size: 20, weight: .regular)).buttonStyle(.plain).padding(.horizontal, 12).padding(.vertical, 4).glassEffect(.regular, in: .capsule).padding(.bottom, 8)
    }

}

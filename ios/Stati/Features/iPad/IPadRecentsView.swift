import SwiftUI

struct IPadRecentsView: View {
    @Environment(\.worshipLiveContext) private var live
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var preferences: ReaderPreferences?
    @State private var message = ""
    @State private var confirmsClear = false
    @State private var preview: FilePreviewRequest?
    @State private var songs: SongGalleryRequest?
    private var largePreviews: Bool { preferences?.settings.largePreviews == true }
    var body: some View {
        let recentItems = store.recents.items
        ScrollView {
            if recentItems.isEmpty { ContentUnavailableView("No recent items", systemImage: "clock", description: Text("Songs and files you open on this device appear here.")) }
            else {
                LazyVGrid(columns: WorshipPreviewGrid.columns(large: largePreviews, accessibility: dynamicTypeSize.isAccessibilitySize), spacing: WorshipPreviewGrid.spacing) {
                    ForEach(recentItems) { item in
                        if item.kind == .song {
                            Button { songs = SongGalleryRequest(computerID: item.computerID, items: recentItems.filter { $0.kind == .song && $0.computerID == item.computerID }.map { SongGalleryItem(id: $0.id, songID: $0.itemID, title: $0.title) }, selectedID: item.id) } label: { IPadSongTile(song: APIRecord(raw: ["id": .string(item.itemID), "title": .string(item.title), "firstSlide": .string(item.firstSlide), "groupName": .string(item.groupName)]), large: largePreviews) }.buttonStyle(.plain).accessibilityLabel(item.title)
                        } else if let file = item.previewItem {
                            Button { preview = FilePreviewRequest(items: recentItems.compactMap(\.previewItem), selectedID: file.id) } label: { IPadSharedFileTile(store: store, file: APIRecord(raw: ["id": .string(item.itemID), "title": .string(item.title), "filename": .string(item.title), "fileUrl": .string(item.filePath), "contentVersion": .string(String(item.openedAt.timeIntervalSince1970)), "groupName": .string(item.openedAt.formatted(date: .abbreviated, time: .omitted))]), large: largePreviews) }.buttonStyle(.plain)
                        }
                    }
                }.padding(24)
            }
            NoticeView(text: store.recents.message).padding()
            NoticeView(text: message).padding(.horizontal)
        }.navigationTitle("Recents").navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear all recents", systemImage: "trash") { confirmsClear = true }
                        .labelStyle(.iconOnly).disabled(store.recents.items.isEmpty)
                }
            }
            .alert("Clear all recents?", isPresented: $confirmsClear) {
                Button("Yes, clear recents", role: .destructive) { store.recents.clearHistory() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Songs and files will stay on this device.")
            }
            .task(id: store.accountEpoch.uuidString + String(store.fileChangeRevision) + String(store.catalogChangeRevision) + String(scenePhase == .active)) {
                guard scenePhase == .active else { return }
                if preferences == nil { preferences = ReaderPreferences(ownerID: store.me?.id ?? "") }
                await reconcile()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: store.refreshDelay); if scenePhase == .active { await reconcile() } } catch { return }
                }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await reconcile() } } }
            .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in preferences?.reload(); store.recents.prune(before: preferences?.settings.retention.cutoff()) }
            .fullScreenCover(item: $preview, onDismiss: { live?.completeReturnToLive() }) { StatiFileViewer(request: $0) }
            .fullScreenCover(item: $songs, onDismiss: { live?.completeReturnToLive() }) { SongGalleryView(store: store, request: $0) }
    }
    private func reconcile() async {
        preferences?.reload()
        store.recents.prune(before: preferences?.settings.retention.cutoff())
        do { try await RecentAvailability.reconcile(store: store); message = "" }
        catch is CancellationError { }
        catch { message = error.localizedDescription }
    }
}

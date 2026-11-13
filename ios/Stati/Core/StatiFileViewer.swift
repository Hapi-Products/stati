import SwiftUI

struct StatiFileViewer: View {
    @Environment(AppStore.self) private var store
    @Environment(\.worshipLiveContext) private var live
    @Environment(\.dismiss) private var dismiss
    let request: FilePreviewRequest
    var navigation: ReaderNavigation? = nil
    @State private var selectedID: String
    @State private var session = FilePreviewSession()
    @State private var retry = UUID()
    @State private var markup: FileMarkupController?
    @State private var prepared = false
    @State private var closing = false
    @State private var usingCurrent = false
    init(request: FilePreviewRequest, navigation: ReaderNavigation? = nil) { self.request = request; self.navigation = navigation; _selectedID = State(initialValue: request.selectedID) }
    private var index: Int { request.items.firstIndex(where: { $0.id == selectedID }) ?? 0 }
    private var item: FilePreviewItem { request.items[index] }
    var body: some View {
        Group {
            if prepared, let url = markup?.source ?? session.url {
                AppleMarkupView(url: url, filename: item.filename, canEdit: markup?.source != nil && markup?.canEdit == true, navigate: { step in if let navigation { navigate(step < 0 ? navigation.previous : navigation.next) } else { change(to: index + step) } }, saved: { markup?.saved($0) }, close: { finish() })
                    .id(selectedID + retry.uuidString).ignoresSafeArea(.container, edges: .top)
            } else {
                NavigationStack {
                    Group {
                        if !session.message.isEmpty { ContentUnavailableView { Label("File unavailable", systemImage: "doc.badge.ellipsis") } description: { Text(session.message) } actions: { Button("Try again", systemImage: "arrow.clockwise") { retry = UUID() } } }
                        else { ProgressView("Opening file…") }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity).navigationTitle(item.filename).navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
                }
            }
        }.background(Color(.systemBackground))
            .safeAreaInset(edge: .bottom) { footer }
            .task(id: selectedID + retry.uuidString) { await load() }
            .onChange(of: store.accountEpoch) { session.close(); dismiss() }
            .onDisappear { session.close() }
            .confirmationDialog("Use the current Stați version?", isPresented: $usingCurrent, titleVisibility: .visible) {
                Button("Use current version") { markup?.useCurrentVersion(); store.resources.invalidate(path: item.path); retry = UUID() }
            } message: { Text("Your earlier Markup stays on this device.") }
    }
    @ViewBuilder private var footer: some View {
        if navigation != nil || request.items.count > 1 || markup?.message.isEmpty == false || closing || live?.reader.following == true {
            VStack(spacing: 8) {
                if let markup, !markup.message.isEmpty {
                    Text(markup.message).font(.footnote).foregroundStyle(Color.statiSecondary)
                    if markup.needsSync {
                        HStack { Button("Sync saved changes") { Task { await markup.sync() } }.disabled(markup.busy); if let url = markup.savedFile { ShareLink("Export saved edit", item: url) }; Button("Use current version") { usingCurrent = true }.disabled(markup.busy) }.font(.footnote)
                        if !markup.busy { Button("Close and keep saved edit") { dismiss() }.font(.footnote) }
                    } else if markup.intent?.state == .keptOnDevice, let url = markup.savedFile { ShareLink("Export earlier Markup", item: url).font(.footnote) }
                }
                if let live, live.reader.following {
                    Button("Back to Live", systemImage: "dot.radiowaves.left.and.right") {
                        finish(returnToLive: true)
                    }
                    .labelStyle(.iconOnly).buttonStyle(.glass)
                    .disabled(closing || markup?.needsSync == true)
                }
                if closing { ProgressView("Saving changes…") }
                if let navigation {
                    ReaderPagingBar(index: navigation.index, count: navigation.count, disabled: closing || markup?.needsSync == true,
                                    previous: { navigate(navigation.previous) }, next: { navigate(navigation.next) },
                                    actions: navigation.actions.map { entry in ReaderAction(id: entry.id, title: entry.title, symbol: entry.symbol, perform: { navigate(entry.perform) }) },
                                    previewPresented: .constant(false)) { EmptyView() }
                } else if request.items.count > 1 {
                    ReaderPagingBar(index: index, count: request.items.count, disabled: closing || markup?.needsSync == true,
                                    previous: { change(to: index - 1) }, next: { change(to: index + 1) }, previewPresented: .constant(false)) { EmptyView() }
                }
            }.padding(.horizontal, 16).padding(.vertical, 8).frame(maxWidth: .infinity)
        }
    }
    private func change(to index: Int) {
        guard request.items.indices.contains(index) else { return }
        navigate { selectedID = request.items[index].id }
    }
    private func navigate(_ action: @escaping () -> Void) {
        guard prepared, !closing, markup?.needsSync != true else { return }
        let epoch = store.accountEpoch
        closing = true
        Task {
            await markup?.editorClosed()
            closing = false
            guard epoch == store.accountEpoch, markup?.needsSync != true else { return }
            action()
        }
    }
    private func finish(returnToLive: Bool = false) {
        guard !closing else { return }; closing = true
        Task {
            await markup?.editorClosed()
            closing = false
            if markup?.needsSync != true {
                if returnToLive { live?.reader.returnRequested = true }
                store.resources.invalidate(path: item.path)
                dismiss()
            }
        }
    }
    private func load() async {
        prepared = false
        let epoch = store.accountEpoch, owner = store.me?.id, selected = selectedID, currentItem = item
        let current = { @MainActor in owner != nil && store.me?.id == owner && store.accountEpoch == epoch && store.api.signedIn && selectedID == selected && !Task.isCancelled }
        await session.load(currentItem, api: store.api, ownerID: owner, resources: store.resources, resourceOwner: epoch.uuidString, decodeContents: false, isCurrent: current)
        guard current(), session.url != nil else { return }
        let controller = FileMarkupController(store: store); markup = controller
        await controller.inspect(currentItem)
        guard current() else { return }
        if FileEditTarget(path: currentItem.path) != nil && !controller.readable && !controller.needsSync {
            store.resources.invalidate(path: currentItem.path); session.fail(controller.message); return
        }
        if !controller.needsSync, !controller.currentSHA.isEmpty, let url = session.url,
           let data = try? Data(contentsOf: url), FileMarkupStorage.digest(data) != controller.currentSHA {
            store.resources.invalidate(path: currentItem.path)
            await session.load(currentItem, api: store.api, ownerID: owner, resources: store.resources, resourceOwner: epoch.uuidString, decodeContents: false, isCurrent: current)
        }
        guard current(), let url = session.url else { return }
        if controller.canEdit && !controller.needsSync { _ = controller.prepare(item: currentItem, url: url) }
        guard current() else { return }; store.recents.opened(file: currentItem); prepared = true
    }
}

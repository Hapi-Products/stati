import SwiftUI

struct ServiceDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let computerID: String
    let initial: APIRecord
    var offline = false
    @State private var editor: ServiceEditor?
    var body: some View {
        Group { if let editor { ServiceEditorContent(editor: editor, offline: offline) } else { ProgressView("Opening service…") } }
            .navigationTitle(editor?.plan.title ?? initial.title).navigationBarTitleDisplayMode(.inline)
            .onChange(of: store.serviceChangeRevision) { if !offline { Task { await editor?.refresh() } } }
            .task { if editor == nil { editor = ServiceEditor(store: store, computerID: computerID, plan: initial, offline: offline) } }
            .task(id: scenePhase) {
                guard !offline, UIDevice.current.userInterfaceIdiom == .pad, scenePhase == .active else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: store.refreshDelay); await editor?.refresh() }
                    catch { return }
                }
            }
    }
}

import SwiftUI

struct ServiceDetailView: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let initial: APIRecord
    @State private var editor: ServiceEditor?
    var body: some View {
        Group { if let editor { ServiceEditorContent(editor: editor) } else { ProgressView("Opening service…") } }
            .navigationTitle(UIDevice.current.userInterfaceIdiom == .pad ? "Service" : editor?.plan.title ?? initial.title).navigationBarTitleDisplayMode(.inline)
            .onChange(of: store.serviceChangeRevision) { Task { await editor?.refresh() } }
            .task { if editor == nil { editor = ServiceEditor(store: store, computerID: computerID, plan: initial) } }
    }
}

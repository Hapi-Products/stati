import SwiftUI

struct SongTextComposer: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let preparing: Bool
    let message: String
    let add: () async -> Bool
    @State private var saving = false

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                TextField("Song title", text: $store.sendDraft.title, prompt: Text("Song title").foregroundStyle(Color.statiSecondary))
                TextEditor(text: $store.sendDraft.text).frame(minHeight: 180).accessibilityLabel("Song text")
                if saving { ProgressView("Adding song text…") }
                if !message.isEmpty { NoticeView(text: message) }
                if !store.uploads.message.isEmpty { NoticeView(text: store.uploads.message) }
            }.contentMargins(.top, 8, for: .scrollContent).navigationTitle("Song Text").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add", systemImage: "checkmark") { Task { saving = true; defer { saving = false }; if await add() { dismiss() } } }.labelStyle(.iconOnly).buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                            .disabled(saving || preparing || store.uploads.busy || store.uploads.availableSlots == 0 || store.sendDraft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.selectedComputer.isEmpty)
                    }
                }.interactiveDismissDisabled(saving)
        }
    }
}

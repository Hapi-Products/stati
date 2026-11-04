import SwiftUI

struct SongCorrectionSelectionEditor: View {
    @Environment(\.dismiss) private var dismiss
    let source: String
    let edit: SongCorrectionEdit
    let apply: (NSRange) -> Void
    @State private var range: NSRange?
    init(source: String, edit: SongCorrectionEdit, apply: @escaping (NSRange) -> Void) { self.source = source; self.edit = edit; self.apply = apply; _range = State(initialValue: edit.range) }
    private var quote: String { guard let range, let selected = Range(range, in: source) else { return "" }; return String(source[selected]) }
    var body: some View {
        NavigationStack {
            ScrollView { SongCorrectionLyrics(text: source, initialSelection: edit.range) { range = $0 }.padding(16) }
                .navigationTitle("Select lyrics").navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge: .bottom) { Text(quote).font(.callout).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading).padding(16).background(.regularMaterial) }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel selection", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) }
                    ToolbarItem(placement: .confirmationAction) { Button("Use selected lyrics", systemImage: "checkmark") { if let range { apply(range); dismiss() } }.labelStyle(ActionIconLabelStyle()).buttonStyle(.glassProminent).disabled(quote.isEmpty || (range?.length ?? 0) > 1000) }
                }
        }
    }
}

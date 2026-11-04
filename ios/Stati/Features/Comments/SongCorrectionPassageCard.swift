import SwiftUI

struct SongCorrectionPassageCard: View {
    let edit: SongCorrectionEdit
    let editable: Bool
    let changeSelection: () -> Void
    let remove: () -> Void
    @Binding var replacement: String
    var body: some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                Button(action: changeSelection) { HStack(alignment: .top) { Text(edit.quote).lineLimit(4).multilineTextAlignment(.leading).foregroundStyle(.primary); Spacer(minLength: 8); Image(systemName: "pencil").accessibilityHidden(true) }.frame(minHeight: 44) }.buttonStyle(.borderless).disabled(!editable).accessibilityLabel("Change selected lyrics: " + edit.quote)
                if editable { Button("Remove passage", systemImage: "xmark") { remove() }.labelStyle(ActionIconLabelStyle()).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44) }
            }
            TextField("Suggested correction", text: $replacement, axis: .vertical).lineLimit(2...6).disabled(!editable)
        } header: { Text("Selected lyrics") }
    }
}

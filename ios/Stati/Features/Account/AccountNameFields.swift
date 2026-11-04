import SwiftUI

struct AccountNameFields: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Binding var first: String
    @Binding var last: String
    let canSave: Bool
    let saving: Bool
    let save: () -> Void
    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 12) { firstField; lastField; HStack { Spacer(); saveButton } }
            } else { HStack(alignment: .bottom, spacing: 12) { firstField; lastField.frame(width: 82); saveButton } }
        }.disabled(saving)
    }
    private var firstField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("First name").font(.caption).foregroundStyle(Color.statiSecondary)
            TextField("First name", text: $first).textContentType(.givenName).textInputAutocapitalization(.words).autocorrectionDisabled().frame(minHeight: 44)
        }
    }
    private var lastField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Last initial").font(.caption).foregroundStyle(Color.statiSecondary)
            TextField("Last initial", text: $last).textInputAutocapitalization(.characters).autocorrectionDisabled().frame(minHeight: 44)
        }
    }
    private var saveButton: some View {
        Button("Save name", systemImage: "checkmark", action: save).labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44).buttonStyle(.borderless).disabled(!canSave)
    }
}

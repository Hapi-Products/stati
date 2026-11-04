import SwiftUI

struct ComputerPicker: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Picker("Computer", selection: $store.selectedComputer) {
            Text("Choose a computer").tag("")
            ForEach(store.computers) { Text($0.name).tag($0.id) }
        }.foregroundStyle(Color.primary)
    }
}
nonisolated extension String {
    var queryEncoded: String { addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
}

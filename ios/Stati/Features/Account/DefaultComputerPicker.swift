import SwiftUI

struct DefaultComputerPicker: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Section {
            Picker("Default computer", selection: $store.defaultComputer) {
                Text("Automatic").tag("")
                ForEach(store.computers) { Text($0.name).tag($0.id) }
                if !store.defaultComputer.isEmpty && !store.computers.contains(where: { $0.id == store.defaultComputer }) { Text("Unavailable computer").tag(store.defaultComputer) }
            }
        } footer: {
            Text(!store.defaultComputer.isEmpty && !store.computers.contains(where: { $0.id == store.defaultComputer }) ? "Your default is unavailable. Using another connected computer until it returns." : "Saved for your account on this device.")
        }
    }
}

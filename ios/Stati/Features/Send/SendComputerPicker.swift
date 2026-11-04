import SwiftUI

struct SendComputerPicker: View {
    @Environment(AppStore.self) private var store
    @State private var scanning = false
    let receivers: [APIRecord]
    private var selected: APIRecord? { store.computers.first { $0.id == store.selectedComputer } }
    private var state: String { receivers.first { $0.id == store.selectedComputer }.map { $0["online"].flag ? "Online" : "Offline" } ?? "Status unavailable" }
    var body: some View {
        @Bindable var store = store
        Menu {
            if let selected { Text(selected.name + " · " + state); Divider() }
            Picker("Computer", selection: $store.selectedComputer) {
                if store.computers.isEmpty { Text("Choose a computer").tag("") }
                ForEach(store.computers) { computer in Text(computer.name).tag(computer.id) }
            }
            Button("Add computer", systemImage: "qrcode.viewfinder") { scanning = true }
        } label: { Label("Computer", systemImage: "desktopcomputer").labelStyle(ActionIconLabelStyle()) }
            .sheet(isPresented: $scanning) { ConnectComputerView() }
            .accessibilityLabel((selected?.name ?? "Choose a computer") + ", " + state)
            .accessibilityHint("Choose your church computer or connect another computer")
    }
}

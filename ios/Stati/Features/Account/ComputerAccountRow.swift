import SwiftUI

struct ComputerAccountRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var typeSize
    let computer: APIRecord
    @State private var inviting = false
    @State private var renaming = false
    @State private var disconnecting = false
    @State private var name = ""
    @State private var message = ""
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading) {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) { Label(computer.name, systemImage: "desktopcomputer").fixedSize(horizontal: false, vertical: true); HStack { Spacer(); actions } }.disabled(busy)
            } else { HStack { Label(computer.name, systemImage: "desktopcomputer"); Spacer(); actions }.disabled(busy) }
            NoticeView(text: message)
        }.sheet(isPresented: $inviting) { NavigationStack { ComputerInviteView(computer: computer) }.presentationSizing(.form) }
        .alert("Rename computer", isPresented: $renaming) {
            TextField("Computer name", text: $name)
            Button("Cancel", role: .cancel) { }
            Button("Save") { Task { await change(rename: true) } }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.confirmationDialog("Disconnect your access to \(computer.name)?", isPresented: $disconnecting, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await change(rename: false) } }
        } message: { Text("Other people will stay connected. Scan its code to connect again.") }
    }
    private var actions: some View {
        HStack {
            if store.isAdmin { Button("Invite new members", systemImage: "qrcode") { inviting = true }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44) }
            if store.isAdmin { Button("Rename computer", systemImage: "pencil") { name = computer.name; renaming = true }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44) }
            Button("Disconnect your access", systemImage: "xmark.circle", role: .destructive) { disconnecting = true }.labelStyle(ActionIconLabelStyle(destructive: true)).frame(minWidth: 44, minHeight: 44)
        }.buttonStyle(.borderless)
    }
    private func change(rename: Bool) async {
        busy = true; defer { busy = false }
        do { _ = try await store.api.request("/devices/" + computer.id + (rename ? "" : "/disconnect"), method: rename ? "PATCH" : "POST", body: .object(rename ? ["name": .string(name)] : [:])); await store.refresh() }
        catch { message = error.localizedDescription }
    }
}

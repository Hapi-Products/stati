import SwiftUI

struct AccountView: View {
    @Environment(AppStore.self) private var store
    @State private var first = ""
    @State private var last = ""
    @State private var message = ""
    @State private var busy = false
    @State private var signingOut = false
    @State private var copiedID = false
    var body: some View {
        Form {
            if let me = store.me {
                Section {
                    HStack(spacing: 12) {
                        MemberAvatar(api: store.api, path: me["photoUrl"].text, initials: String(me.personName.prefix(1)))
                        VStack(alignment: .leading, spacing: 4) { Text(me.personName).font(.headline) }
                    }.padding(.vertical, 4)
                }
                Section {
                    AccountNameFields(first: $first, last: $last, canSave: canSave(me), saving: busy) { Task { await save() } }
                    if !message.isEmpty { NoticeView(text: message) }
                }
                DefaultComputerPicker()
                if store.isAdmin {
                    Section { Link(destination: URL(string: "https://stati.ciani01.org/account")!) {
                        HStack { Label("Administrator PIN", systemImage: "key"); Spacer(); Image(systemName: "arrow.up.right").font(.footnote).accessibilityHidden(true) }.foregroundStyle(Color.primary).frame(minHeight: 44)
                    }.accessibilityHint("Opens account settings on the Stați website") }
                }
                computers
                if !store.isAdmin { Section { Link("Open account on website", destination: URL(string: "https://stati.ciani01.org/account")!) } }
                Section { Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { signingOut = true }.frame(minHeight: 44) }
                LabeledSection("Account ID") {
                    HStack(spacing: 12) {
                        Text(me.id).font(.caption.monospaced()).textSelection(.enabled).foregroundStyle(Color.statiSecondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                        Button(copiedID ? "Account ID copied" : "Copy account ID", systemImage: copiedID ? "checkmark" : "doc.on.doc") { UIPasteboard.general.string = me.id; copiedID = true }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44).buttonStyle(.borderless)
                    }
                }
            }
        }.navigationTitle("Account").navigationBarTitleDisplayMode(.large)
            .task(id: store.me?.id) { first = store.me?["first_name"].text ?? ""; last = store.me?["last_initial"].text ?? "" }
            .confirmationDialog("Sign out of Stați?", isPresented: $signingOut, titleVisibility: .visible) { Button("Sign out", role: .destructive) { Task { await store.signOut() } } } message: { Text("Unsent files stay safely on this device for your account.") }
    }
    private var computers: some View {
        LabeledSection("Computers") {
            if store.computers.isEmpty { Text("No computers connected").foregroundStyle(Color.statiSecondary) }
            ForEach(store.computers) { computer in ComputerAccountRow(computer: computer) }
        }
    }
    private func canSave(_ me: APIRecord) -> Bool {
        !busy && !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && last.count == 1 && (first != me["first_name"].text || last != me["last_initial"].text)
    }
    private func save() async {
        busy = true; defer { busy = false }
        let name = first; let initial = last
        do { _ = try await store.api.request("/me", method: "PATCH", body: .object(["firstName": .string(name), "lastInitial": .string(initial)])); await store.refresh(); message = "Name saved." }
        catch { message = error.localizedDescription }
    }
}

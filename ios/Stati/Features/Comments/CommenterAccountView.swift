import SwiftUI

struct CommenterAccountView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        List {
            if let person = store.me {
                Section { HStack(spacing: 12) { MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person["first_name"].text.prefix(1)), size: 36); Text(person.personName).font(.headline) }.padding(.vertical, 4) }
            }
            DefaultComputerPicker()
            Section {
                AppIconPickerButton()
                NavigationLink { WhatsNewView() } label: { Label("What’s New", systemImage: "sparkles") }
                NavigationLink { PrivacyView() } label: { Label("Privacy", systemImage: "hand.raised") }
            }
            Section { Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { Task { await store.signOut() } } }
        }.navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
    }
}

import SwiftUI

struct IPadAccountButton: View {
    let store: AppStore
    let open: () -> Void
    var body: some View {
        if let person = store.me {
            Button(action: open) {
                HStack(spacing: 8) {
                    MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person["first_name"].text.prefix(1)), size: 28)
                    Text(person.personName).font(.subheadline.weight(.medium)).lineLimit(1)
                }.fixedSize(horizontal: true, vertical: false).frame(minHeight: 44)
            }.buttonStyle(.plain).accessibilityLabel("Account, " + person.personName)
        }
    }
}

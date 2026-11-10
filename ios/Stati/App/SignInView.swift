import SwiftUI

struct SignInView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var signIn = MobileSignIn()
    private var iPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image("Brand").resizable().scaledToFit().frame(width: 88, height: 88).clipShape(.rect(cornerRadius: 16)).accessibilityHidden(true)
                    Text(iPad ? "Stați Worship" : "Stați").font(.largeTitle.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(iPad ? "Your worship library" : "Send it to church.").font(.title2.weight(.semibold)).multilineTextAlignment(.center)
                    if typeSize.isAccessibilitySize { passkeyAction }
                    VStack(alignment: .leading, spacing: 16) {
                        if iPad {
                            Label("Browse songs from Stați Cloud", systemImage: "icloud")
                            Label("Open lyrics and slides", systemImage: "music.note.list")
                            Label("Follow your service’s running order", systemImage: "list.number")
                        } else {
                            Label("Choose files or song text", systemImage: "doc.text")
                            Label("Send to your church computer", systemImage: "square.and.arrow.up")
                            Label("See when the computer saves it", systemImage: "checkmark.circle")
                        }
                    }.foregroundStyle(Color.statiSecondary).frame(maxWidth: .infinity, alignment: .leading)
                    if !typeSize.isAccessibilitySize { passkeyAction }
                    NavigationLink("Privacy", value: MoreRoute.privacy).font(.footnote).frame(minHeight: 44)
                    Text("Hapi Products").font(.footnote).foregroundStyle(Color.statiSecondary)
                }.padding(.horizontal, 24).padding(.top, 72).padding(.bottom, 32).frame(maxWidth: 520).frame(maxWidth: .infinity)
            }.background(Color(uiColor: .systemGroupedBackground))
                .navigationDestination(for: MoreRoute.self) { route in if route == .privacy { PrivacyView() } }
        }
    }
    private var passkeyAction: some View {
        VStack(spacing: 12) {
            Button { Task { await signIn.signIn(store: store) } } label: {
                Label(signIn.busy ? "Opening sign-in…" : "Sign in with passkey", systemImage: "person.badge.key").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            }.buttonStyle(.borderedProminent).tint(AppIconAppearance.shared.fill).foregroundStyle(.white).disabled(signIn.busy)
            NoticeView(text: signIn.message.isEmpty ? store.message : signIn.message)
        }
    }
}

import SwiftUI

struct ProfileView: View {
    @Environment(AppStore.self) private var store
    @State private var members: [APIRecord] = []
    @State private var teamMessage = ""
    @State private var loadingTeam = true
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                NavigationLink(value: MoreRoute.team) {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack { Text("Team").font(.title2.weight(.semibold)); Spacer(); Image(systemName: "chevron.right").font(.subheadline.weight(.semibold)) }
                        if loadingTeam { ProgressView("Loading team…") }
                        else if !teamMessage.isEmpty { Text(teamMessage).font(.subheadline).foregroundStyle(Color.statiSecondary) }
                        else if teamPreview.isEmpty { Text("View your church team").font(.subheadline).foregroundStyle(Color.statiSecondary) }
                        else {
                            VStack(spacing: 16) {
                                ForEach(teamPreview) { member in
                                    HStack(spacing: 14) {
                                        MemberAvatar(api: store.api, path: member["photoUrl"].text, initials: String(member.personName.prefix(1)), size: 36)
                                        Text(member.personName).font(.body.weight(.medium))
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12).contentShape(.rect)
                }.buttonStyle(.plain).foregroundStyle(Color.primary)
                VStack(spacing: 0) {
                    NavigationLink(value: MoreRoute.account) { ProfileDestinationRow(title: "Account", icon: "person.crop.circle") }
                    Divider().padding(.leading, 56)
                    if AppIconAppearance.allowsCustomization {
                        AppIconPickerButton(profileRow: true).buttonStyle(.plain)
                        Divider().padding(.leading, 56)
                    }
                    Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                        ProfileDestinationRow(title: "Settings", icon: "gearshape")
                    }.buttonStyle(.plain)
                    Divider().padding(.leading, 56)
                    NavigationLink(value: MoreRoute.computers) { ProfileDestinationRow(title: "Computers", icon: "desktopcomputer") }
                    if !store.songCommands.requests.isEmpty || store.songCommands.needsRecovery {
                        Divider().padding(.leading, 56)
                        NavigationLink(value: MoreRoute.songRequests) { ProfileDestinationRow(title: "Song requests", icon: "clock.arrow.circlepath") }
                    }
                }
                VStack(spacing: 0) {
                    NavigationLink(value: MoreRoute.features) { ProfileDestinationRow(title: "Features", icon: "slider.horizontal.3") }
                    Divider().padding(.leading, 56)
                    NavigationLink { DiagnosticsView() } label: { ProfileDestinationRow(title: "Diagnostics", icon: "stethoscope") }
                    Divider().padding(.leading, 56)
                    NavigationLink(value: MoreRoute.whatsNew) { ProfileDestinationRow(title: "What’s New", icon: "sparkles") }
                    Divider().padding(.leading, 56)
                    NavigationLink(value: MoreRoute.privacy) { ProfileDestinationRow(title: "Privacy", icon: "hand.raised") }
                }
                Text("Stați · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "7"))")
                    .font(.footnote).foregroundStyle(Color.statiSecondary)
            }.padding(.horizontal, 24).padding(.bottom, 28).frame(maxWidth: 600).frame(maxWidth: .infinity)
        }.background(.background).navigationTitle("").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    if let person = store.me {
                        HStack(spacing: 8) {
                            MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person.personName.prefix(1)), size: 28)
                            Text(person.personName).font(.headline).lineLimit(1)
                        }.accessibilityElement(children: .combine)
                    }
                }
            }
            .navigationDestination(for: MoreRoute.self) { route in
                switch route { case .account: AccountView(); case .features: PhoneFeaturesView(); case .team: TeamView(); case .computers: ComputersView(); case .songRequests: SongRequestsView(); case .privacy: PrivacyView(); case .whatsNew: WhatsNewView() }
            }
            .task(id: store.me?.id) { await loadTeam() }
            .refreshable { await loadTeam() }
    }
    private var teamPreview: [APIRecord] { Array(members.filter { $0.id != store.me?.id }.prefix(3)) }
    private func loadTeam() async {
        let owner = store.me?.id
        members = []; teamMessage = ""; loadingTeam = true
        defer { loadingTeam = false }
        guard owner != nil else { return }
        do {
            let result = try await store.api.request("/members").records
            try Task.checkCancellation()
            guard store.me?.id == owner else { return }
            members = result
        } catch is CancellationError { }
        catch { if store.me?.id == owner { teamMessage = "Team could not load. Open Team to try again." } }
    }
}

import SwiftUI

struct IPadAccountView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Bindable var preferences: IPadPreferences
    let groups: [String]
    let namedGroups: WorshipGroupsModel
    @State private var reviewFeatures = false
    @State private var reviewWorship = false
    @State private var signingOut = false
    @State private var path: [MoreRoute] = []
    var body: some View {
        NavigationStack(path: $path) {
            Form {
                if let person = store.me { Section { HStack(spacing: 16) { MemberAvatar(api: store.api, path: person["photoUrl"].text, initials: String(person["first_name"].text.prefix(1)), size: 54); Text(person.personName).font(.title3.weight(.semibold)) } } }
                DefaultComputerPicker()
                Section { NavigationLink("Worship") { worshipSettings }.navigationDestination(isPresented: $reviewWorship) { worshipSettings } }
                Section { NavigationLink("Features") { IPadFeaturesView(ownerID: preferences.ownerID) }.navigationDestination(isPresented: $reviewFeatures) { IPadFeaturesView(ownerID: preferences.ownerID) } }
                Section { NavigationLink("What’s New", value: MoreRoute.whatsNew); NavigationLink("Privacy", value: MoreRoute.privacy) }
                Section { Button("Sign out", role: .destructive) { signingOut = true; Task { await store.signOut(); dismiss() } }.disabled(signingOut) }
            }.navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close account", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()).disabled(signingOut) } }
                .navigationDestination(for: MoreRoute.self) { route in switch route { case .team: IPadTeamView(); case .whatsNew: WhatsNewView(); case .privacy: PrivacyView(); default: EmptyView() } }
                .onAppear {
                    #if DEBUG && targetEnvironment(simulator)
                    if ["ipad-features", "ipad-pdf-columns-features", "ipad-worship-help", "ipad-worship-help-next"].contains(NativeReview.route ?? "") { reviewFeatures = true }
                    if NativeReview.route == "ipad-worship" { reviewWorship = true }
                    if NativeReview.route == "ipad-team" { path = [.team] }
                    if NativeReview.route == "ipad-privacy" { path = [.privacy] }
                    if NativeReview.route == "ipad-whats-new" { path = [.whatsNew] }
                    #endif
                }
        }.presentationSizing(.form).interactiveDismissDisabled(signingOut)
    }
    private var worshipSettings: some View {
        Form {
            if store.canReadSongs {
                Section {
                        Picker("Default group", selection: $preferences.selection) {
                            Text("Automatic").tag(GroupSelection.automatic)
                            Text("Original songs").tag(GroupSelection.originalSongs)
                            Text("All groups").tag(GroupSelection.allGroups)
                            if !namedGroups.groups.isEmpty { Section("Worship groups") { ForEach(namedGroups.groups) { Text($0.name).tag(GroupSelection.named($0.id)) } } }
                            if !groups.isEmpty { Section("Folders") { ForEach(groups, id: \.self) { Text($0).tag(GroupSelection.legacy($0)) } } }
                        }
                        if namedGroups.canCreate || !namedGroups.groups.isEmpty { NavigationLink("Groups") { WorshipGroupsManagementView(store: store, groups: namedGroups) } }
                    NoticeView(text: preferences.message)
                }
            }
            Section { NavigationLink("Team members") { IPadTeamView() } }
        }.navigationTitle("Worship").navigationBarTitleDisplayMode(.inline)
    }

}

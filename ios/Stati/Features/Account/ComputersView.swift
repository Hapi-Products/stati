import SwiftUI

struct ComputersView: View {
    @Environment(AppStore.self) private var store
    @State private var scanning = false

    #if DEBUG && targetEnvironment(simulator)
    @State private var reviewInvite = NativeReview.route == "computers-invite"
    #endif
    init() {
        #if DEBUG && targetEnvironment(simulator)
        _scanning = State(initialValue: NativeReview.route == "computers-scan")
        #endif
    }
    var body: some View {
        List {
            if !store.message.isEmpty {
                Section { NoticeView(text: store.message) }
            }
            if store.computers.isEmpty {
                if store.loading {
                    ProgressView("Loading computers…")
                } else {
                    ContentUnavailableView("No computers connected", systemImage: "desktopcomputer", description: Text("Connect using the code shown on your church computer.").foregroundStyle(Color.statiSecondary))
                }
            } else {
                ForEach(store.computers) { computer in
                    ComputerAccountRow(computer: computer)
                }
            }
        }
        .navigationTitle("Computers")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Add computer", systemImage: "plus") { scanning = true }.labelStyle(ActionIconLabelStyle()) } }
        .sheet(isPresented: $scanning) { ConnectComputerView() }
        .refreshable { await store.refresh() }
        #if DEBUG && targetEnvironment(simulator)
        .sheet(isPresented: $reviewInvite) { if let computer = store.computers.first { NavigationStack { ComputerInviteView(computer: computer) }.presentationSizing(.form) } }
        #endif
    }
}

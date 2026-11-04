import SwiftUI

struct IPadServicesView: View {
    @Environment(AppStore.self) private var store
    @State private var plans: [APIRecord] = []
    @State private var loading = false
    @State private var message = ""
    @State private var query = ""
    var body: some View {
        List {
            ForEach(plans.filter { !$0["archived"].flag && (query.isEmpty || $0.title.localizedStandardContains(query) || $0["date"].text.localizedStandardContains(query)) }) { plan in
                NavigationLink(value: IPadSidebarRoute.service(plan.id)) { VStack(alignment: .leading, spacing: 5) { Text(plan.title).font(.headline); Text(plan["date"].text + " · " + plan["time"].text + " · \(plan["songs"].items.count) songs").font(.footnote).foregroundStyle(Color.statiSecondary) } }
            }
            if loading { ProgressView("Loading services…") }
            if !loading && plans.isEmpty && message.isEmpty { ContentUnavailableView("No services yet", systemImage: "calendar") }
            NoticeView(text: message)
        }.navigationTitle("Service").navigationBarTitleDisplayMode(.large)
            .searchable(text: $query, placement: .toolbar, prompt: "Search services").searchToolbarBehavior(.minimize)
            .onChange(of: store.serviceChangeRevision) { Task { await load() } }
            .task(id: store.accountEpoch.uuidString + store.selectedComputer) { await load() }.refreshable { await load() }
    }
    private func load() async {
        guard !store.selectedComputer.isEmpty else { plans = []; return }
        let epoch = store.accountEpoch, owner = store.me?.id, computer = store.selectedComputer
        loading = true; defer { if epoch == store.accountEpoch && computer == store.selectedComputer { loading = false } }
        do { let rows = try await store.api.request("/computers/" + computer + "/services")["plans"].records; try Task.checkCancellation(); guard owner != nil, owner == store.me?.id, epoch == store.accountEpoch, computer == store.selectedComputer else { return }; plans = rows; message = "" }
        catch is CancellationError { }
        catch { if epoch == store.accountEpoch { message = error.localizedDescription } }
    }
}

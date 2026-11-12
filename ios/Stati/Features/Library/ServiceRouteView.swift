import SwiftUI

struct ServiceRouteView: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let serviceID: String
    var showServices: (() -> Void)? = nil
    @State private var plan: APIRecord?
    @State private var message = ""
    var body: some View {
        Group {
            if let plan { ServiceDetailView(computerID: computerID, initial: plan) }
            else if !message.isEmpty { ContentUnavailableView("Service unavailable", systemImage: "calendar.badge.exclamationmark", description: Text(message)) }
            else { ProgressView("Opening service…") }
        }
        .toolbar {
            if let showServices {
                ToolbarItem(placement: .topBarLeading) {
                    Button("All services", systemImage: "chevron.left", action: showServices)
                        .labelStyle(.iconOnly)
                }
            }
        }
        .task(id: store.accountEpoch.uuidString + computerID + serviceID) {
            let epoch = store.accountEpoch
            plan = nil; message = ""
            do {
                let rows = try await store.api.request("/computers/" + computerID + "/services")["plans"].records
                try Task.checkCancellation(); guard epoch == store.accountEpoch, computerID == store.selectedComputer else { return }
                plan = rows.first(where: { $0.id == serviceID })
                if plan == nil { message = "This service was removed or your access changed. Return to services and refresh." }
            } catch { message = error.localizedDescription }
        }
    }
}

import ActivityKit
import SwiftUI

@MainActor @Observable final class LiveClicker {
    struct Connection: Equatable {
        let sessionID: String
        let itemID: String
        let sequence: Int
        let page: Int
        let count: Int?
        let turn: String?
        let song: String
        let service: String
        let serviceID: String

        init?(_ live: JSONValue) {
            let position = live["position"]
            sessionID = position["sessionId"].text
            serviceID = position["serviceId"].text
            itemID = position["itemId"].text
            guard [sessionID, serviceID, itemID].allSatisfy({ UUID(uuidString: $0) != nil }),
                  let sequence = Int(exactly: position["sequence"].number), sequence > 0,
                  let page = Int(exactly: position["page"].number), page >= 0 else { return nil }
            self.sequence = sequence
            self.page = page
            count = Int(exactly: position["pageCount"].number).flatMap { $0 > page && $0 <= 10_001 ? $0 : nil }
            turn = UUID(uuidString: position["clickerTurn"].text) == nil ? nil : position["clickerTurn"].text
            song = live["songTitle"].text
            service = live["serviceTitle"].text
        }
    }

    private(set) var connection: Connection?
    private(set) var message = ""
    private(set) var turning = false
    private(set) var checked = false
    private var refreshID = UUID()
    private var mutation = UUID()
    private var activitySession: String?

    func reset() {
        mutation = UUID()
        refreshID = UUID()
        connection = nil
        checked = false
        turning = false
        message = ""
        activitySession = nil
    }

    private func path(_ computer: String) -> String { "/computers/" + computer + "/live-clicker" }

    func refresh(store: AppStore, showActivity: Bool = false, expectedSession: String? = nil) async {
        guard !turning, let owner = store.me?.id, store.canReadSongs, store.api.signedIn,
              !store.selectedComputer.isEmpty else { return }
        let computer = store.selectedComputer, epoch = store.accountEpoch, mutation = mutation
        let requestID = UUID()
        refreshID = requestID
        func current() -> Bool {
            !Task.isCancelled && store.accountEpoch == epoch && store.selectedComputer == computer &&
                self.mutation == mutation && self.refreshID == requestID
        }
        do {
            let response = try await store.api.request(path(computer))
            guard current() else { return }
            connection = Connection(response["live"])
            message = ""
            checked = true
            if let connection {
                if showActivity && (expectedSession == nil || expectedSession == connection.sessionID) {
                    activitySession = connection.sessionID
                }
                let hasActivity = Activity<ServiceActivityAttributes>.activities.contains { $0.attributes.clickerSessionID == connection.sessionID }
                if activitySession == connection.sessionID || hasActivity {
                    await updateActivity(connection, owner: owner, computer: computer)
                } else { await endActivities() }
            } else {
                activitySession = nil
                await endActivities()
            }
        } catch {
            guard current() else { return }
            connection = nil
            checked = true
            message = "Live clicker unavailable. Check your connection and try again."
            if let error = error as? APIError, [401, 403, 404].contains(error.status) { await endActivities() }
        }
    }

    func move(_ direction: Int, session: String, store: AppStore) async {
        guard !turning, let live = connection, live.sessionID == session,
              let count = live.count, (0..<count).contains(live.page + direction) else { return }
        let epoch = store.accountEpoch, computer = store.selectedComputer, operation = UUID()
        mutation = operation
        turning = true
        defer { if mutation == operation { turning = false } }
        do {
            let response = try await store.api.request(path(computer), method: "POST", body: .object([
                "sessionId": .string(live.sessionID), "itemId": .string(live.itemID), "sequence": .number(Double(live.sequence)),
                "page": .number(Double(live.page)), "turn": live.turn.map(JSONValue.string) ?? .null, "direction": .number(Double(direction)),
            ]))
            guard !Task.isCancelled, mutation == operation, store.accountEpoch == epoch, store.selectedComputer == computer else { return }
            connection = Connection(.object(["position": response["position"], "songTitle": .string(live.song), "serviceTitle": .string(live.service)]))
            message = ""
        } catch {
            guard !Task.isCancelled, mutation == operation, store.accountEpoch == epoch, store.selectedComputer == computer else { return }
            connection = nil
            message = "Couldn’t confirm the page turn. Check the current page before trying again."
        }
        turning = false
        await refresh(store: store)
    }

    func endActivities(except session: String? = nil) async {
        for activity in Activity<ServiceActivityAttributes>.activities
        where activity.attributes.clickerSessionID != nil && activity.attributes.clickerSessionID != session {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    private func updateActivity(_ live: Connection, owner: String, computer: String) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        await endActivities(except: live.sessionID)
        guard !Task.isCancelled, connection?.sessionID == live.sessionID else { return }
        let state = ServiceActivityAttributes.ContentState(song: String(live.song.prefix(300)))
        let content = ActivityContent(state: state, staleDate: nil)
        if let activity = Activity<ServiceActivityAttributes>.activities.first(where: { $0.attributes.clickerSessionID == live.sessionID }) {
            if activity.content.state != state { await Self.updateActivity(id: activity.id, song: state.song) }
        } else {
            let attributes = ServiceActivityAttributes(accountID: owner, computerID: computer, serviceID: live.serviceID,
                                                       service: String(live.service.prefix(80)), clickerSessionID: live.sessionID)
            _ = try? Activity.request(attributes: attributes, content: content)
        }
    }

    @concurrent nonisolated private static func updateActivity(id: String, song: String) async {
        guard !Task.isCancelled, let activity = Activity<ServiceActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
        await activity.update(ActivityContent(state: ServiceActivityAttributes.ContentState(song: song), staleDate: nil))
    }
}

struct LiveClickerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let clicker: LiveClicker
    @Binding var session: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if let live = clicker.connection, session == nil || live.sessionID == session {
                        VStack(spacing: 8) {
                            Text(live.service).font(.subheadline).foregroundStyle(.secondary)
                            Text(live.song).font(.title.bold())
                            if let count = live.count {
                                Text("Page \(live.page + 1) of \(count)").monospacedDigit().foregroundStyle(.secondary)
                            } else {
                                Text("Open a song in Slides or PDF on the leader’s iPad.").foregroundStyle(.secondary)
                            }
                        }
                        HStack(spacing: 16) {
                            arrow(-1, label: "Previous page", icon: "chevron.left").disabled(clicker.turning || live.count == nil || live.page == 0)
                            arrow(1, label: "Next page", icon: "chevron.right").disabled(clicker.turning || live.count.map { live.page + 1 >= $0 } != false)
                        }
                    } else if !clicker.checked {
                        ProgressView("Connecting to the live reader…")
                    } else {
                        ContentUnavailableView("No live reader connected", systemImage: "cursorarrow.click",
                                               description: Text(unavailableMessage))
                        Button("Retry", systemImage: "arrow.clockwise") { Task { await clicker.refresh(store: store) } }
                            .buttonStyle(.glass)
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Live Clicker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Leave clicker", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
            }
            .onChange(of: clicker.connection?.sessionID, initial: true) { _, id in
                if session == nil { session = id }
            }
        }
    }

    private var unavailableMessage: String {
        if let session, let live = clicker.connection, live.sessionID != session {
            return "This session has ended. Open Live Clicker from Send to connect to the current service."
        }
        if !clicker.message.isEmpty { return clicker.message }
        return "Start leading on the iPad and select the same computer on your iPhone."
    }

    private func arrow(_ direction: Int, label: String, icon: String) -> some View {
        Button {
            if let id = session ?? clicker.connection?.sessionID { Task { await clicker.move(direction, session: id, store: store) } }
        } label: {
            Label(label, systemImage: icon)
                .labelStyle(.iconOnly)
                .font(.title2.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 80)
                .contentShape(.rect)
        }
        .buttonStyle(.glass)
    }
}

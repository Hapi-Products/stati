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
        let songID: String
        let contentHash: String
        let mode: SongReaderMode
        let columns: PDFColumnCount
        let size: SlideTextSize
        let transition: ReaderTransition

        init?(_ live: JSONValue) {
            let position = live["position"]
            sessionID = position["sessionId"].text
            serviceID = position["serviceId"].text
            itemID = position["itemId"].text
            let standalone = position["songHash"].text.utf8.count == 64 && position["serviceId"] == .null
            guard UUID(uuidString: sessionID) != nil,
                  standalone ? itemID.utf8.count == 64 : UUID(uuidString: serviceID) != nil && UUID(uuidString: itemID) != nil,
                  let sequence = Int(exactly: position["sequence"].number), sequence > 0,
                  let page = Int(exactly: position["page"].number), page >= 0 else { return nil }
            self.sequence = sequence
            self.page = page
            count = Int(exactly: position["pageCount"].number).flatMap { $0 > page && $0 <= 10_001 ? $0 : nil }
            turn = UUID(uuidString: position["clickerTurn"].text) == nil ? nil : position["clickerTurn"].text
            song = live["songTitle"].text
            service = live["serviceTitle"].text
            songID = live["songId"].text
            contentHash = live["contentHash"].text
            mode = SongReaderMode(rawValue: position["mode"].text) ?? .slides
            columns = Int(exactly: position["columns"].number).flatMap(PDFColumnCount.init(rawValue:)) ?? .one
            transition = ReaderTransition(rawValue: position["transition"].text) ?? .instant
            size = SlideTextSize(sliderPosition: position["slideSize"].number) ?? .large
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
        guard let live = connection else { return }
        await jump(to: live.page + direction, session: session, store: store)
    }

    func jump(to page: Int, session: String, store: AppStore) async {
        guard !turning, let live = connection, live.sessionID == session,
              let count = live.count, (0..<count).contains(page), page != live.page else { return }
        let epoch = store.accountEpoch, computer = store.selectedComputer, operation = UUID()
        mutation = operation
        turning = true
        defer { if mutation == operation { turning = false } }
        do {
            var command: [String: JSONValue] = [
                "sessionId": .string(live.sessionID), "itemId": .string(live.itemID), "sequence": .number(Double(live.sequence)),
                "page": .number(Double(live.page)), "turn": live.turn.map(JSONValue.string) ?? .null,
            ]
            let offset = page - live.page
            if abs(offset) == 1 { command["direction"] = .number(Double(offset)) }
            else { command["targetPage"] = .number(Double(page)) }
            let response = try await store.api.request(path(computer), method: "POST", body: .object(command))
            guard !Task.isCancelled, mutation == operation, store.accountEpoch == epoch, store.selectedComputer == computer else { return }
            connection = Connection(.object([
                "position": response["position"], "songTitle": .string(live.song), "serviceTitle": .string(live.service),
                "songId": .string(live.songID), "contentHash": .string(live.contentHash)
            ]))
            guard connection != nil else {
                throw APIError(status: 502, message: "The page turn could not be confirmed.")
            }
            message = ""
        } catch {
            guard !Task.isCancelled, mutation == operation, store.accountEpoch == epoch, store.selectedComputer == computer else { return }
            connection = nil
            message = "Couldn’t confirm the page turn. Check the current page before trying again."
            turning = false
            await refresh(store: store)
        }
    }

    func reportPresence(session: String, store: AppStore) async {
        guard let live = connection, live.sessionID == session, live.count != nil,
              store.canReadSongs, store.api.signedIn, !store.selectedComputer.isEmpty else { return }
        _ = try? await store.api.request(path(store.selectedComputer), method: "PATCH",
                                        body: .object(["sessionId": .string(session)]))
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
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("stati.clicker.arrowsAtBottom") private var arrowsAtBottom = true
    @State private var previewRetry = 0
    @State private var showingPages = false
    @State private var testing = false
    let clicker: LiveClicker
    @Binding var session: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if let live {
                        VStack(spacing: 5) {
                            Text(live.service).font(.subheadline).foregroundStyle(.secondary)
                            Text(live.song).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                            if let count = live.count {
                                Button("Page \(live.page + 1) of \(count)") { showingPages = true }
                                    .monospacedDigit().disabled(clicker.turning)
                            } else {
                                Text("Open a song in Slides or PDF on the leader’s iPad.").foregroundStyle(.secondary)
                            }
                        }
                        if !arrowsAtBottom { arrows(live) }
                        if live.count != nil {
                            LiveClickerPreview(live: live, computer: store.selectedComputer, retry: previewRetry,
                                               enabled: !clicker.turning) { jump(to: $0, in: live) }
                        }
                    } else if !clicker.checked {
                        ProgressView("Connecting to the live reader…")
                    } else {
                        ContentUnavailableView("No live reader connected", systemImage: "cursorarrow.click",
                                               description: Text(unavailableMessage))
                    }
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: 460)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .safeAreaBar(edge: .bottom) {
                if arrowsAtBottom, let live {
                    arrows(live).frame(maxWidth: 460).padding(.horizontal, 24).padding(.vertical, 10)
                }
            }
            .sheet(isPresented: $showingPages) {
                NavigationStack {
                    List {
                        if let live, let count = live.count {
                            ForEach(0..<count, id: \.self) { page in
                                Button("Page \(page + 1)", systemImage: page == live.page ? "checkmark" : "doc") {
                                    showingPages = false
                                    jump(to: page, in: live)
                                }
                            }
                        }
                    }
                    .navigationTitle("Go to page").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { showingPages = false }.labelStyle(.iconOnly)
                    } }
                }
            }
            .sheet(isPresented: $testing) { ClickerRehearsalView(receives: false) }
            .navigationTitle("Live Clicker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Leave clicker", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Retry live connection", systemImage: "arrow.clockwise") {
                        Task { await clicker.refresh(store: store, showActivity: true, expectedSession: session) }
                        previewRetry += 1
                    }.labelStyle(.iconOnly).disabled(clicker.turning)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Clicker options", systemImage: "slider.horizontal.3") {
                        Button("Clicker Test", systemImage: "stopwatch") { testing = true }
                        Picker("Arrow position", selection: $arrowsAtBottom) {
                            Text("Middle").tag(false)
                            Text("Bottom").tag(true)
                        }
                    }.labelStyle(.iconOnly)
                }
            }
            .task(id: (live?.sessionID ?? "") + String(scenePhase == .active) + String(live?.count != nil)) {
                guard scenePhase == .active, let live, live.count != nil else { return }
                let session = live.sessionID
                while !Task.isCancelled {
                    await clicker.reportPresence(session: session, store: store)
                    do { try await Task.sleep(for: .seconds(4)) } catch { return }
                }
            }
            .onChange(of: clicker.connection?.sessionID, initial: true) { _, id in
                if session == nil { session = id }
            }
        }
    }

    private var live: LiveClicker.Connection? {
        guard let connection = clicker.connection, session == nil || connection.sessionID == session else { return nil }
        return connection
    }

    private func arrows(_ live: LiveClicker.Connection) -> some View {
        HStack(spacing: 16) {
            arrow(-1, label: "Previous page", icon: "chevron.left").disabled(clicker.turning || live.count == nil || live.page == 0)
            arrow(1, label: "Next page", icon: "chevron.right").disabled(clicker.turning || live.count.map { live.page + 1 >= $0 } != false)
        }
    }

    private var unavailableMessage: String {
        if let session, let live = clicker.connection, live.sessionID != session {
            return "This session has ended. Open Live Clicker from Send to connect to the current service."
        }
        if !clicker.message.isEmpty { return clicker.message }
        return "Start leading on the iPad and select the same computer on your iPhone."
    }

    private func jump(to page: Int, in live: LiveClicker.Connection) {
        Task { await clicker.jump(to: page, session: live.sessionID, store: store) }
    }

    private func arrow(_ direction: Int, label: String, icon: String) -> some View {
        Button {
            if let id = session ?? clicker.connection?.sessionID { Task { await clicker.move(direction, session: id, store: store) } }
        } label: {
            Label(label, systemImage: icon)
                .labelStyle(.iconOnly)
                .font(.title2.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 60)
                .contentShape(.rect)
        }
        .buttonStyle(.glass)
    }
}

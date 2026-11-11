import ActivityKit
import Foundation

@MainActor final class ServiceLiveActivities {
    private let system = ActivityAuthorizationInfo()

    func follow(store: AppStore, enabled: Bool, foreground: Bool) async {
        let owner = store.me?.id ?? "", computer = store.selectedComputer, epoch = store.accountEpoch
        let authorized = enabled && system.areActivitiesEnabled && store.canReadSongs && store.api.signedIn
            && !owner.isEmpty && !computer.isEmpty
        for activity in Activity<ServiceActivityAttributes>.activities
        where !authorized || activity.attributes.accountID != owner || activity.attributes.computerID != computer {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        guard foreground, authorized else { return }
        while !Task.isCancelled {
            var delay: Duration = .seconds(15)
            do {
                let response = try await store.api.request("/computers/" + computer + "/live-song")
                try Task.checkCancellation()
                guard store.accountEpoch == epoch, store.selectedComputer == computer, store.canReadSongs else { return }
                let live = response["live"]
                if live == .null {
                    await end(owner: owner, computer: computer)
                    delay = .seconds(35)
                } else {
                    await display(live, owner: owner, computer: computer)
                }
            } catch is CancellationError { return }
            catch let error as APIError where [401, 403, 404].contains(error.status) {
                if !Task.isCancelled, store.accountEpoch == epoch, store.selectedComputer == computer { await end(owner: owner, computer: computer) }
                delay = .seconds(60)
            } catch { delay = .seconds(45) }
            do { try await Task.sleep(for: delay) } catch { return }
        }
    }

    private func display(_ live: JSONValue, owner: String, computer: String) async {
        let serviceID = live["serviceId"].text, service = live["serviceTitle"].text, song = live["songTitle"].text
        let deadline = Date(timeIntervalSince1970: live["expiresAt"].number)
        let displayedService = String(service.prefix(80))
        guard !serviceID.isEmpty, !service.isEmpty, !song.isEmpty, deadline > .now else {
            await end(owner: owner, computer: computer)
            return
        }
        let content = ActivityContent(state: ServiceActivityAttributes.ContentState(song: String(song.prefix(300))), staleDate: deadline)
        let matches = Activity<ServiceActivityAttributes>.activities.filter { $0.attributes.accountID == owner && $0.attributes.computerID == computer }
        if let current = matches.first, current.attributes.serviceID == serviceID, current.attributes.service == displayedService {
            if current.content.state != content.state || current.content.staleDate != deadline {
                await Self.update(id: current.id, song: content.state.song, deadline: deadline)
            }
            return
        }
        await end(owner: owner, computer: computer)
        guard !Task.isCancelled else { return }
        let attributes = ServiceActivityAttributes(accountID: owner, computerID: computer, serviceID: serviceID, service: displayedService)
        _ = try? Activity.request(attributes: attributes, content: content)
    }

    @concurrent nonisolated private static func update(id: String, song: String, deadline: Date) async {
        guard !Task.isCancelled, let activity = Activity<ServiceActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
        await activity.update(ActivityContent(state: ServiceActivityAttributes.ContentState(song: song), staleDate: deadline))
    }

    private func end(owner: String, computer: String) async {
        for activity in Activity<ServiceActivityAttributes>.activities
        where activity.attributes.accountID == owner && activity.attributes.computerID == computer {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

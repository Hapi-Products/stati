import SwiftUI

struct BuildPauseControl: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var status: Status?
    @State private var busy = false
    @State private var error = ""

    private struct Status {
        let manuallyPaused: Bool
        let serviceProtected: Bool

        init(_ value: JSONValue) throws {
            guard case let .bool(manual) = value["manualPaused"],
                  case let .bool(selected) = value["activeService"] else {
                throw APIError(status: 503, message: "Build status is unavailable.")
            }
            manuallyPaused = manual
            serviceProtected = selected || value["scheduledUntil"].number > 0
        }
    }

    var body: some View {
        Section {
            if let status {
                Toggle(isOn: Binding(get: { self.status?.manuallyPaused ?? false }, set: { paused in
                    Task { await update(paused: paused) }
                })) {
                    Label("Pause Builds", systemImage: "pause.circle")
                }
                .disabled(busy)
                if status.serviceProtected {
                    Label("Builds are on hold during service", systemImage: "calendar.badge.clock")
                        .foregroundStyle(.secondary)
                }
            } else if busy || error.isEmpty {
                ProgressView("Checking build status…")
            } else {
                Button("Retry build status", systemImage: "arrow.clockwise") { Task { await update() } }
            }
            if !error.isEmpty {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Builds")
        } footer: {
            Text("Pause app releases and preview installs until you turn this off. Scheduled and active services also hold releases automatically.")
        }
        .onChange(of: store.accountEpoch) {
            status = nil
            error = ""
            busy = false
        }
        .task(id: scenePhase == .active ? store.accountEpoch : nil) {
            guard scenePhase == .active else { return }
            await update()
        }
    }

    private func update(paused: Bool? = nil) async {
        guard store.isAdmin, !busy else { return }
        let epoch = store.accountEpoch
        busy = true
        error = ""
        defer { if epoch == store.accountEpoch { busy = false } }
        do {
            let data = try await store.api.request("/admin/build-pause", method: paused == nil ? "GET" : "PUT",
                                                   body: paused.map { .object(["paused": .bool($0)]) })
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            status = try Status(data)
        } catch {
            guard epoch == store.accountEpoch, !Task.isCancelled else { return }
            status = nil
            self.error = error.localizedDescription
        }
    }
}

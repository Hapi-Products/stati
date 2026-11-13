import SwiftUI

@MainActor @Observable
final class LiveWorshipReader {
    enum Status: String {
        case idle, waiting, live, offline

        var title: String {
            switch self {
            case .idle: "No active service"
            case .waiting: "Waiting for a live leader"
            case .live: "Connected to the leader"
            case .offline: "Live connection unavailable"
            }
        }

        var color: Color {
            switch self {
            case .idle: Color(uiColor: .systemGray)
            case .waiting, .offline: .red
            case .live: .green
            }
        }
    }

    struct Position: Equatable {
        var item: String
        var page: Int
        var mode: SongReaderMode
        var transition: ReaderTransition
        var columns: PDFColumnCount
        var size: SlideTextSize
        var pageCount: Int? = nil

        init(item: String, page: Int, mode: SongReaderMode, transition: ReaderTransition, columns: PDFColumnCount, size: SlideTextSize) {
            self.item = item
            self.page = page
            self.mode = mode
            self.transition = transition
            self.columns = columns
            self.size = size
        }

        init?(_ value: JSONValue) {
            let item = value["itemId"].text
            guard UUID(uuidString: item) != nil, let page = Int(exactly: value["page"].number),
                  let mode = SongReaderMode(rawValue: value["mode"].text),
                  let transition = ReaderTransition(rawValue: value["transition"].text),
                  let columnValue = Int(exactly: value["columns"].number),
                  let columns = PDFColumnCount(rawValue: columnValue),
                  let size = SlideTextSize(sliderPosition: value["slideSize"].number) else { return nil }
            self.init(item: item, page: page, mode: mode, transition: transition, columns: columns, size: size)
            pageCount = Int(exactly: value["pageCount"].number).flatMap { $0 > page ? $0 : nil }
        }
    }

    private struct Session {
        let id = UUID().uuidString.lowercased()
        let service: String
        let path: String
        let epoch: UUID
        var sequence = 0
        var canRenewWithoutPosition = true
    }

    private(set) var status: Status = .idle
    private(set) var position: Position?
    private(set) var serviceID = ""
    private(set) var following = false
    private(set) var leading = false
    private(set) var starting = false
    private(set) var message = ""
    struct ClickerTurn: Equatable {
        let id: String
        let position: Position
    }

    private(set) var clickerTurn: ClickerTurn?
    @ObservationIgnored private var receivedTurn = ""
    @ObservationIgnored private var acknowledgedSequence = 0
    @ObservationIgnored private var sentRevision = 0
    @ObservationIgnored private var session: Session?
    @ObservationIgnored private var desired: Position?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var sender: Task<Void, Never>?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var promptedServices: Set<String> = []

    func shouldOfferLeading(service: String) -> Bool {
        !leading && promptedServices.insert(service).inserted
    }

    func listen(store: AppStore, group: String, service: String) async {
        let computer = store.selectedComputer
        let epoch = store.accountEpoch
        let path = endpoint(computer: computer, group: group)
        guard !computer.isEmpty, !group.isEmpty, !service.isEmpty, store.canReadSongs else {
            following = false; position = nil; serviceID = ""; status = .idle
            return
        }
        while !Task.isCancelled && store.accountEpoch == epoch && store.selectedComputer == computer {
            do {
                let response = try await store.api.request(path)
                try Task.checkCancellation()
                guard store.accountEpoch == epoch, store.selectedComputer == computer else { return }
                status = Status(rawValue: response["state"].text) ?? .offline
                let payload = response["position"]
                let next = Position(payload)
                if let session, session.id == payload["sessionId"].text, let next,
                   !payload["clickerTurn"].text.isEmpty, payload["clickerTurn"].text != receivedTurn,
                   Int(exactly: payload["sequence"].number) == acknowledgedSequence,
                   sentRevision == revision, next.item == desired?.item,
                   next.mode == desired?.mode, next.pageCount == desired?.pageCount {
                    receivedTurn = payload["clickerTurn"].text
                    desired = next
                    clickerTurn = ClickerTurn(id: receivedTurn, position: next)
                }
                following = status == .live && session?.id != payload["sessionId"].text &&
                    payload["serviceId"].text == service && next != nil
                serviceID = following ? service : ""
                position = following ? next : nil
                try await Task.sleep(for: status == .live ? .seconds(1) : .seconds(5))
            } catch is CancellationError { return }
            catch {
                guard !Task.isCancelled else { return }
                status = .offline; following = false; position = nil; serviceID = ""
                if let failure = error as? APIError, [401, 403, 404].contains(failure.status) { return }
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
            }
        }
    }

    func start(store: AppStore, group: String, service: String, position: Position) {
        guard session == nil, !group.isEmpty, !service.isEmpty, !store.selectedComputer.isEmpty else { return }
        let path = endpoint(computer: store.selectedComputer, group: group)
        session = Session(service: service, path: path, epoch: store.accountEpoch)
        message = ""
        starting = true
        update(position, store: store)
        heartbeat = Task { [weak self, weak store] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
                guard let self, let store, let session = self.session, session.epoch == store.accountEpoch,
                      let desired = self.desired else { return }
                if self.sentRevision != self.revision {
                    self.sendPosition(store: store)
                    continue
                }
                if !session.canRenewWithoutPosition {
                    self.revision += 1
                    self.sendPosition(store: store)
                    continue
                }
                do {
                    _ = try await store.api.request(session.path, method: "PATCH", body: .object(["sessionId": .string(session.id)]))
                } catch let error as APIError where [404, 405].contains(error.status) {
                    guard !Task.isCancelled, self.session?.id == session.id else { return }
                    self.session?.canRenewWithoutPosition = false
                    self.revision += 1
                    self.sendPosition(store: store)
                } catch let error as APIError where [401, 403, 409].contains(error.status) {
                    guard !Task.isCancelled, self.session?.id == session.id else { return }
                    self.message = error.localizedDescription
                    self.stop(store: store)
                    return
                } catch { }
            }
        }
    }

    func update(_ position: Position, store: AppStore) {
        guard session?.epoch == store.accountEpoch, position != desired else { return }
        desired = position
        revision += 1
        sendPosition(store: store)
    }

    func readerClosed(store: AppStore) {
        guard var desired else { return }
        desired.pageCount = nil
        update(desired, store: store)
    }

    private func sendPosition(store: AppStore) {
        guard sender == nil else { return }
        sender = Task { [weak self, weak store] in
            guard let self, let store, let started = self.session?.id else { return }
            defer { if self.session?.id == started { self.sender = nil } }
            while !Task.isCancelled, var session = self.session, session.id == started,
                  let current = self.desired, self.revision != self.sentRevision, session.epoch == store.accountEpoch {
                let sending = self.revision
                session.sequence += 1
                self.session = session
                var payload: [String: JSONValue] = [
                    "serviceId": .string(session.service), "sessionId": .string(session.id),
                    "sequence": .number(Double(session.sequence)), "itemId": .string(current.item),
                    "page": .number(Double(current.page)), "mode": .string(current.mode.rawValue),
                    "transition": .string(current.transition.rawValue), "columns": .number(Double(current.columns.rawValue)),
                    "slideSize": .number(current.size.sliderPosition),
                ]
                if let count = current.pageCount { payload["pageCount"] = .number(Double(count)) }
                do {
                    let result = try await store.api.request(session.path, method: "PUT", body: .object(payload))
                    guard !Task.isCancelled, self.session?.id == started else { return }
                    guard result["ok"].flag else { throw APIError(status: 502, message: "Stați could not confirm the live connection.") }
                    self.leading = true
                    self.starting = false
                    self.status = .live
                    self.sentRevision = sending
                    self.acknowledgedSequence = session.sequence
                } catch is CancellationError { return }
                catch {
                    guard self.session?.id == started else { return }
                    if session.sequence > 1, !(error is APIError) { return }
                    self.message = error.localizedDescription
                    self.stop(store: store)
                    return
                }
            }
        }
    }

    func stop(store: AppStore) {
        let ending = session
        session = nil; desired = nil; leading = false; starting = false
        clickerTurn = nil; receivedTurn = ""; acknowledgedSequence = 0
        sender?.cancel(); sender = nil
        heartbeat?.cancel(); heartbeat = nil
        guard let ending, ending.epoch == store.accountEpoch else { return }
        status = .waiting
        Task { _ = try? await store.api.request(ending.path, method: "DELETE", body: .object(["sessionId": .string(ending.id)])) }
    }

    private func endpoint(computer: String, group: String) -> String {
        "/computers/" + computer + "/worship-live/" + group
    }
}


struct WorshipLiveContext {
    let reader: LiveWorshipReader
    let items: [APIRecord]
    let shouldOffer: () -> Bool
    let lead: (LiveWorshipReader.Position) -> Void
}

extension EnvironmentValues {
    @Entry var worshipLiveContext: WorshipLiveContext?
}

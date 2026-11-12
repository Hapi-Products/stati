import Foundation

nonisolated struct IPadWorkspaceSelection {
    var tab = "groups"
    var path: [IPadSidebarRoute] = []
    var serviceID: String?
    var groupSelection: GroupSelection?

    mutating func select(_ value: String) {
        path = []
        serviceID = nil
        groupSelection = nil
        switch IPadSidebarRoute(selection: value) {
        case .service(let id):
            tab = "service"
            serviceID = id
        case .group(let id):
            tab = "shared"
            groupSelection = .named(id)
        case .folder(let name):
            tab = "browse"
            path = [.folder(name)]
        case nil:
            tab = value
        }
    }
}

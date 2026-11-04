import Foundation
nonisolated struct IPadWorkspaceSelection {
    var tab = "groups"
    var path: [IPadSidebarRoute] = []
    var servicePath: [IPadSidebarRoute] = []
    mutating func select(_ value: String) {
        if let page = IPadSidebarRoute(selection: value) {
            if case .service = page { servicePath = [page]; path = []; tab = "service" }
            else { path = [page]; tab = "browse" }
        }
        else { tab = value; path = [] }
    }
}

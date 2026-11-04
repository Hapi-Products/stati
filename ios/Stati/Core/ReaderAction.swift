import Foundation

struct ReaderAction: Identifiable {
    let id: String
    let title: String
    let symbol: String
    let perform: () -> Void
}
struct ReaderNavigation {
    let index: Int
    let count: Int
    let previous: () -> Void
    let next: () -> Void
    var actions: [ReaderAction] = []
}

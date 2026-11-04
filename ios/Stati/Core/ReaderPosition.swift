import Foundation

nonisolated struct ReaderPosition: Equatable, Sendable {
    let ids: [String]
    private(set) var index: Int
    var selectedID: String { ids[index] }
    var canGoBack: Bool { index > 0 }
    var canGoForward: Bool { index + 1 < ids.count }
    init?(ids: [String], selectedID: String) {
        var seen: Set<String> = []
        let unique = ids.filter { !$0.isEmpty && seen.insert($0).inserted }
        guard let index = unique.firstIndex(of: selectedID) else { return nil }
        self.ids = unique; self.index = index
    }
    @discardableResult mutating func move(by step: Int) -> Bool {
        guard step == -1 || step == 1, ids.indices.contains(index + step) else { return false }
        index += step; return true
    }
}

import Foundation

nonisolated struct FilePreviewRequest: Identifiable {
    let id = UUID()
    let items: [FilePreviewItem]
    let selectedID: String
    init?(items: [FilePreviewItem], selectedID: String) {
        var seen: Set<String> = []
        let unique = items.filter { seen.insert($0.id).inserted }
        guard unique.contains(where: { $0.id == selectedID }) else { return nil }
        self.items = unique; self.selectedID = selectedID
    }
    init?(record: APIRecord, pathKey: String) {
        guard let item = FilePreviewItem(record: record, pathKey: pathKey) else { return nil }
        self.init(items: [item], selectedID: item.id)
    }
}

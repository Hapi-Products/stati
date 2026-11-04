import Foundation

nonisolated struct DeviceRecent: Codable, Identifiable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case song, file }
    let kind: Kind
    let computerID: String
    let itemID: String
    let title: String
    let firstSlide: String
    let groupName: String
    let filePath: String
    let openedAt: Date
    var id: String { kind.rawValue + ":" + computerID + ":" + itemID }
    var previewItem: FilePreviewItem? { FilePreviewItem(record: APIRecord(raw: ["fileUrl": .string(filePath), "filename": .string(title)]), pathKey: "fileUrl") }
}

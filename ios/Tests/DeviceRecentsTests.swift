import Testing
import Foundation
@testable import StatiCore

@MainActor struct DeviceRecentsTests {
    @Test func openingItemsPersistsTheirOrderOnlyForThatDeviceAndAccount() throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let owner = UUID().uuidString, other = UUID().uuidString
        let store = DeviceRecents(storageDirectory: directory); store.load(ownerID: owner)
        let first = APIRecord(raw: ["id": .string(String(repeating: "a", count: 64)), "title": .string("First")])
        let second = APIRecord(raw: ["id": .string(String(repeating: "b", count: 64)), "title": .string("Second")])
        store.opened(song: first, computerID: "computer"); store.opened(song: second, computerID: "computer"); store.opened(song: first, computerID: "computer")
        #expect(store.items.map(\.title) == ["First", "Second"])
        let reopened = DeviceRecents(storageDirectory: directory); reopened.load(ownerID: owner)
        #expect(reopened.items == store.items)
        reopened.load(ownerID: other); #expect(reopened.items.isEmpty)
        let separateDevice = DeviceRecents(storageDirectory: directory.appending(path: "another-device")); separateDevice.load(ownerID: owner)
        #expect(separateDevice.items.isEmpty)
    }
    @Test func unreadableHistoryIsKeptWithoutOverwritingIt() throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let owner = UUID().uuidString, path = directory.appending(path: owner + ".json"), bytes = Data("{broken".utf8)
        try bytes.write(to: path)
        let store = DeviceRecents(storageDirectory: directory); store.load(ownerID: owner)
        store.opened(song: APIRecord(raw: ["id": .string(String(repeating: "a", count: 64)), "title": .string("First")]), computerID: "computer")
        #expect(try Data(contentsOf: path) == bytes); #expect(!store.message.isEmpty)
    }
}

@Suite @MainActor struct RecentCleanupTests {
    @Test func expiryOnlyPrunesHistoryAndNeverDeletesAnOriginal() throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let owner = UUID().uuidString, original = directory.appending(path: "original.pdf")
        let bytes = Data("preserved original".utf8); try bytes.write(to: original)
        let now = Date(timeIntervalSince1970: 2_000_000)
        let rows = [DeviceRecent(kind: .file, computerID: "", itemID: "old", title: "Old", firstSlide: "", groupName: "", filePath: "/api/group-materials/old/file", openedAt: now.addingTimeInterval(-15 * 86400)), DeviceRecent(kind: .song, computerID: "pc", itemID: "new", title: "New", firstSlide: "", groupName: "", filePath: "", openedAt: now)]
        try JSONEncoder().encode(rows).write(to: directory.appending(path: owner + ".json"))
        let store = DeviceRecents(storageDirectory: directory); store.load(ownerID: owner)
        store.prune(before: nil); #expect(store.items.count == 2)
        store.prune(before: now.addingTimeInterval(-14 * 86400)); #expect(store.items.map(\.title) == ["New"])
        #expect(try Data(contentsOf: original) == bytes)
        let reopened = DeviceRecents(storageDirectory: directory); reopened.load(ownerID: owner); #expect(reopened.items.map(\.title) == ["New"])
    }
    @Test func availabilityOnlyRemovesCheckedMissingItemsAndKeepsNewlyOpenedItems() throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceRecents(storageDirectory: directory); store.load(ownerID: UUID().uuidString)
        for letter in ["a", "b"] { store.opened(song: APIRecord(raw: ["id": .string(String(repeating: letter, count: 64)), "title": .string(letter)]), computerID: "pc") }
        let checked = Set(store.items.map(\.id))
        store.opened(song: APIRecord(raw: ["id": .string(String(repeating: "c", count: 64)), "title": .string("c")]), computerID: "pc")
        store.reconcile(checkedIDs: checked, availableIDs: [checked.first!])
        #expect(store.items.count == 2); #expect(store.items.contains { $0.title == "c" })
        let snapshot = store.items
        store.reconcile(checkedIDs: checked, availableIDs: ["not-requested"])
        #expect(store.items == snapshot)
    }
    @Test func cleanupDoesNotOverwriteUnreadableHistory() throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let owner = UUID().uuidString, file = directory.appending(path: owner + ".json"), bytes = Data("{broken history".utf8)
        try bytes.write(to: file)
        let store = DeviceRecents(storageDirectory: directory); store.load(ownerID: owner)
        store.prune(before: .now); store.reconcile(checkedIDs: ["old"], availableIDs: []); store.remove(id: "old")
        #expect(try Data(contentsOf: file) == bytes)
    }
}

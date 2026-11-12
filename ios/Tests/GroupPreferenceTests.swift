import Testing
import Foundation
@testable import StatiCore

@Suite @MainActor struct GroupPreferenceTests {
    @Test func systemGroupModeMirrorsSimpleChoicesAndKeepsNamedGroupsInTheirAccount() throws {
        let suite = "stati-group-mirror-" + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        GroupPreference.saveWorship(.named("private-choir"), ownerID: "a", defaults: defaults)
        #expect(defaults.string(forKey: "stati.worship.defaultGroupMode") == "saved")
        #expect(GroupPreference.readWorship(ownerID: "b", defaults: defaults) == .automatic)
        defaults.set("originalSongs", forKey: "stati.worship.defaultGroupMode")
        #expect(GroupPreference.readWorship(ownerID: "a", defaults: defaults) == .originalSongs)
        defaults.set("saved", forKey: "stati.worship.defaultGroupMode")
        #expect(GroupPreference.readWorship(ownerID: "a", defaults: defaults) == .named("private-choir"))

        GroupPreference.saveWorship(.allGroups, ownerID: "a", defaults: defaults)
        #expect(defaults.string(forKey: "stati.worship.defaultGroupMode") == "allGroups")
        #expect(GroupPreference.read(ownerID: "a", defaults: defaults) == .named("private-choir"))
    }
    @Test func namedIdentityCannotCollideWithALegacyLabel() {
        let id = UUID().uuidString.lowercased()
        #expect(GroupSelection.named(id) != .legacy(id))
        #expect(GroupSelection.originalSongs.hidesGroups)
        #expect(!GroupSelection.named(id).hidesGroups)
    }
    @Test func defaultsStayOnThisDeviceAndAccountAndMigrateWithoutDeletingTheOldValue() {
        let suite = "stati-group-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("Choir", forKey: "stati.ipad.defaultGroup.owner-a")
        #expect(GroupPreference.read(ownerID: "owner-a", defaults: defaults) == .legacy("Choir"))
        GroupPreference.save(.originalSongs, ownerID: "owner-a", defaults: defaults)
        #expect(GroupPreference.read(ownerID: "owner-a", defaults: UserDefaults(suiteName: suite)!) == .originalSongs)
        #expect(GroupPreference.read(ownerID: "owner-b", defaults: defaults) == .automatic)
        #expect(defaults.string(forKey: "stati.ipad.defaultGroup.owner-a") == "Choir")
    }
    @Test func removedGroupsFallbackOnlyAfterTheAccessibleListHasFinishedLoading() {
        let value = GroupSelection.named("removed")
        #expect(value.resolved(named: [], legacy: [], loaded: false) == value)
        #expect(value.resolved(named: [], legacy: [], loaded: true) == .allGroups)
        #expect(GroupSelection.named("a").resolved(named: ["a"], legacy: [], loaded: true) == .named("a"))
        #expect(GroupSelection.legacy("Choir").resolved(named: [], legacy: ["Choir"], loaded: true) == .legacy("Choir"))
    }
    @Test func unreadablePreferenceIsKeptUntilTheUserChoosesAnotherDefault() {
        let suite = "stati-group-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let bytes = Data("[unreadable preference".utf8)
        defaults.set(bytes, forKey: "stati.ipad.groupSelection.owner")
        #expect(GroupPreference.read(ownerID: "owner", defaults: defaults) == .automatic)
        #expect(defaults.data(forKey: "stati.ipad.groupSelection.owner") == bytes)
    }
}

import Testing
import Foundation
@testable import StatiCore

@Suite @MainActor struct ComputerPreferenceTests {
    @Test func defaultIsScopedToAccountAndSurvivesReload() {
        let suite = "stati-preference-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        ComputerPreference.save("choir-pc", ownerID: "owner-a", defaults: defaults)
        ComputerPreference.save("sound-pc", ownerID: "owner-b", defaults: defaults)
        #expect(ComputerPreference.read(ownerID: "owner-a", defaults: UserDefaults(suiteName: suite)!) == "choir-pc")
        #expect(ComputerPreference.read(ownerID: "owner-b", defaults: defaults) == "sound-pc")
        #expect(ComputerPreference.read(ownerID: "", defaults: defaults).isEmpty)
    }
    @Test func currentSessionWinsAndUnavailableDefaultFallsBack() {
        #expect(ComputerPreference.resolve(preferred: "a", current: "b", available: ["a", "b"]) == "b")
        #expect(ComputerPreference.resolve(preferred: "b", current: "", available: ["a", "b"]) == "b")
        #expect(ComputerPreference.resolve(preferred: "removed", current: "", available: ["a"]) == "a")
        #expect(ComputerPreference.resolve(preferred: "a", current: "a", available: []).isEmpty)
    }
}

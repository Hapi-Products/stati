import Foundation
import Testing
@testable import StatiCore

@MainActor
@Test func diagnosticsKeepMoreThanFiftyEntriesUntilTheirDayExpires() {
    let suite = "DiagnosticsLogTests." + UUID().uuidString
    guard let defaults = UserDefaults(suiteName: suite) else {
        Issue.record("Could not isolate diagnostic preferences.")
        return
    }
    defer { defaults.removePersistentDomain(forName: suite) }
    let key = "stati.diagnostics.recentFailures"
    let time = Date(timeIntervalSince1970: 1_800_000_000)
    func entry(secondsAgo: TimeInterval) -> String {
        "\(time.addingTimeInterval(-secondsAgo).ISO8601Format()) · Connection · Network request failed"
    }
    let recent = (0..<85).map { entry(secondsAgo: TimeInterval($0 * 60)) }
    defaults.set(recent + [entry(secondsAgo: 86_400), entry(secondsAgo: 86_401), "Invalid timestamp"], forKey: key)
    #expect(DiagnosticsLog.prune(now: time, defaults: defaults) == recent)
    #expect(defaults.stringArray(forKey: key) == recent)
    #expect(DiagnosticsLog.prune(now: time.addingTimeInterval(86_400), defaults: defaults).isEmpty)
}

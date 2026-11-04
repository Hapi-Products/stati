import Testing
@testable import StatiCore
@Suite struct ReleaseNotesPolicyTests {
    @Test func tabletShowsItsFirstObservedBuildAndLaterUpdates() {
        #expect(ReleaseNotesPolicy.shouldPresent(isIPad: true, automaticOnIPad: true, lastSeen: "", current: "23"))
        #expect(ReleaseNotesPolicy.shouldPresent(isIPad: true, automaticOnIPad: true, lastSeen: "22", current: "23"))
        #expect(!ReleaseNotesPolicy.shouldPresent(isIPad: true, automaticOnIPad: true, lastSeen: "23", current: "23"))
    }
    @Test func onlyTabletCanOptOut() {
        #expect(!ReleaseNotesPolicy.shouldPresent(isIPad: true, automaticOnIPad: false, lastSeen: "22", current: "23"))
        #expect(ReleaseNotesPolicy.shouldPresent(isIPad: false, automaticOnIPad: false, lastSeen: "22", current: "23"))
        #expect(!ReleaseNotesPolicy.shouldPresent(isIPad: false, automaticOnIPad: true, lastSeen: "", current: "23"))
        #expect(!ReleaseNotesPolicy.shouldPresent(isIPad: true, automaticOnIPad: true, lastSeen: "22", current: ""))
    }
}

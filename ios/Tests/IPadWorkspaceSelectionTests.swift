import Testing
@testable import StatiCore

@Suite struct IPadWorkspaceSelectionTests {
    @Test func namedGroupOpensInsideGroupsAndClearsWhenLeaving() {
        var value = IPadWorkspaceSelection()
        value.select("named:private-id")
        #expect(value.tab == "shared")
        #expect(value.groupSelection == .named("private-id"))
        #expect(value.path.isEmpty)
        value.select("browse")
        value.select("shared")
        #expect(value.groupSelection == nil)
    }

    @Test func serviceDetailsStayInsideServiceAndClearWhenLeaving() {
        var value = IPadWorkspaceSelection()
        value.select("service:sunday")
        #expect(value.tab == "service")
        #expect(value.serviceID == "sunday")
        #expect(value.path.isEmpty)
        value.select("browse")
        value.select("service")
        #expect(value.serviceID == nil)
    }

    @Test func folderNavigationStillUsesTheSongsPath() {
        var value = IPadWorkspaceSelection()
        value.select("group:Choir")
        #expect(value.tab == "browse")
        #expect(value.path == [.folder("Choir")])
        value.select("browse")
        #expect(value.path.isEmpty)
    }
}

import Testing
@testable import StatiCore
@Suite struct IPadWorkspaceSelectionTests {
    @Test func servicesStayInTheirOwnDestinationAndGroupsStayInBrowse() {
        var value = IPadWorkspaceSelection()
        value.select("service:sunday")
        #expect(value.tab == "service")
        #expect(value.servicePath == [.service("sunday")])
        value.select("named:private-id")
        #expect(value.tab == "browse")
        #expect(value.path == [.group("private-id")])
    }
    @Test func topLevelNavigationClearsThePreviousSidebarPage() {
        var value = IPadWorkspaceSelection()
        value.select("service:sunday"); value.select("tasks")
        #expect(value.tab == "tasks" && value.path.isEmpty)
        value.select("group:Choir"); value.select("browse")
        #expect(value.tab == "browse" && value.path.isEmpty)
    }
}

@Suite struct ServiceDestinationTests {
 @Test func returningToServiceKeepsItsRunningOrderWithoutBrowsing() {
  var value = IPadWorkspaceSelection(); value.select("service:sunday"); value.select("tasks"); value.select("service")
  #expect(value.tab == "service")
  #expect(value.servicePath == [.service("sunday")])
  #expect(value.path.isEmpty)
 }
}

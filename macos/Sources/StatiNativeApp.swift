import SwiftUI
import AppKit

@main struct StatiNativeApp: App {
    @NSApplicationDelegateAdaptor(NativeAppDelegate.self) private var delegate
    @State private var model = WorkspaceModel()
    var body: some Scene {
        WindowGroup("Stați Native Preview") {
            WorkspaceView(model: model).onAppear { delegate.engine = model.engine }
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Switch Profile…") { model.showProfile = true }.keyboardShortcut("u", modifiers: [.command, .shift]).disabled(!model.unlocked)
                Button("Invite Members…") { Task { await model.showInvite() } }.disabled(!model.station["adminUnlocked"].bool)
            }
        }
        Settings { NativeSettingsView(model: model) }
    }
}
@MainActor final class NativeAppDelegate: NSObject, NSApplicationDelegate {
    var engine: EngineClient?
    private var terminating = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateNow }
        terminating = true
        ClockController.shared.hideAll()
        Task { await engine?.stop(); sender.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

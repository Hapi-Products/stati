import SwiftUI
import AppKit
import Observation

struct NativeClock: Codable, Identifiable {
    var id = UUID()
    var name = "Desktop clock"
    var fontSize = 52.0
    var seconds = false
    var twentyFourHour = false
    var background = true
    var lightText = true
}
@MainActor @Observable final class ClockController {
    static let shared = ClockController()
    var clocks: [NativeClock] = []
    private var windows: [UUID: NSWindow] = [:]
    init() {
        if let data = UserDefaults.standard.data(forKey: "nativeClocks"), let saved = try? JSONDecoder().decode([NativeClock].self, from: data) { clocks = Array(saved.prefix(5)) }
    }
    func save() { if let data = try? JSONEncoder().encode(clocks) { UserDefaults.standard.set(data, forKey: "nativeClocks") } }
    func add() { guard clocks.count < 5 else { return }; let clock = NativeClock(); clocks.append(clock); save(); show(clock) }
    func show(_ clock: NativeClock) {
        if let window = windows[clock.id] { window.orderFront(nil); return }
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 380, height: 130), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.isOpaque = false; window.backgroundColor = .clear
        window.level = .floating; window.isMovableByWindowBackground = true
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = NSHostingView(rootView: ClockOverlay(controller: self, id: clock.id))
        window.setFrameAutosaveName("native-clock-\(clock.id.uuidString)")
        window.setFrameUsingName("native-clock-\(clock.id.uuidString)")
        windows[clock.id] = window; window.orderFront(nil)
    }
    func hide(_ id: UUID) { windows.removeValue(forKey: id)?.close() }
    func remove(_ id: UUID) { hide(id); clocks.removeAll { $0.id == id }; save() }
    func hideAll() { for id in Array(windows.keys) { hide(id) } }
}
struct ClockOverlay: View {
    var controller: ClockController
    let id: UUID
    var body: some View {
        if let clock = controller.clocks.first(where: { $0.id == id }) {
            TimelineView(.periodic(from: .now, by: clock.seconds ? 1 : 15)) { context in
                Text(time(context.date, clock)).font(.system(size: clock.fontSize, weight: .medium, design: .rounded)).monospacedDigit()
                    .foregroundStyle(clock.lightText ? .white : .black).padding(22).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(clock.background ? Color.black.opacity(0.82) : .clear, in: .rect(cornerRadius: 18))
                    .accessibilityLabel("Current time \(time(context.date, clock))")
            }.contextMenu { Button("Hide Clock") { controller.hide(id) } }
        }
    }
    private func time(_ date: Date, _ clock: NativeClock) -> String {
        let formatter = DateFormatter(); formatter.dateFormat = clock.twentyFourHour ? (clock.seconds ? "HH:mm:ss" : "HH:mm") : (clock.seconds ? "h:mm:ss a" : "h:mm a"); return formatter.string(from: date)
    }
}
struct NativeClocksView: View {
    @State private var controller = ClockController.shared
    var body: some View {
        Form {
            Section {
                Text("Native clocks float above other windows. Drag a clock to position it; right-click to hide it.").foregroundStyle(.secondary)
                Button("Add Clock", systemImage: "plus") { controller.add() }.disabled(controller.clocks.count >= 5)
            }
            ForEach($controller.clocks) { $clock in
                Section(clock.name) {
                    TextField("Name", text: $clock.name)
                    Slider(value: $clock.fontSize, in: 24...90) { Text("Text size") }
                    Toggle("Show seconds", isOn: $clock.seconds)
                    Toggle("24-hour time", isOn: $clock.twentyFourHour)
                    Toggle("Dark background", isOn: $clock.background)
                    Toggle("Light text", isOn: $clock.lightText)
                    HStack { Button("Show") { controller.show(clock) }; Button("Hide") { controller.hide(clock.id) }; Spacer(); Button("Delete", role: .destructive) { controller.remove(clock.id) } }
                }
            }
            Section { Text("These SwiftUI clocks use separate preview settings. Automatic screen contrast and existing Electron clock settings have not been migrated.").font(.caption).foregroundStyle(.secondary) }
        }.formStyle(.grouped).onChange(of: controller.clocks.map { "\($0.id)\($0.name)\($0.fontSize)\($0.seconds)\($0.twentyFourHour)\($0.background)\($0.lightText)" }) { _, _ in controller.save() }
    }
}

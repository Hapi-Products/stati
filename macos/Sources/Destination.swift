import SwiftUI

enum Destination: String, CaseIterable, Identifiable {
    case station = "Station", prepare = "Prepare slides", library = "Library", services = "Services", tasks = "Tasks", groups = "Groups", clocks = "Desktop clocks", settings = "Settings"
    var id: Self { self }
    var iconColor: Color {
        switch self {
        case .station: .blue
        case .prepare: .indigo
        case .library: .pink
        case .services: .orange
        case .tasks: .blue
        case .groups: .purple
        case .clocks, .settings: .gray
        }
    }

    var symbol: String {
        switch self {
        case .station: "tray.and.arrow.down"
        case .prepare: "rectangle.on.rectangle"
        case .library: "music.note.list"
        case .services: "list.bullet.rectangle"
        case .clocks: "clock"
        case .settings: "gearshape"
        case .tasks: "checklist"
        case .groups: "person.2.fill"
        }
    }
}

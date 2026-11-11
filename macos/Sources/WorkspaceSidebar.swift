import SwiftUI

struct WorkspaceSidebar: View {
    let model: WorkspaceModel
    @Binding var selection: Destination?
    @State private var query = ""

    private let sections: [(title: String, destinations: [Destination])] = [
        ("Workspace", [.station, .prepare, .library, .services]),
        ("Team", [.tasks, .groups]),
        ("Tools", [.clocks, .settings])
    ]

    private var visibleSections: [(title: String, destinations: [Destination])] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return sections.map { section in
            (section.title, section.destinations.filter {
                search.isEmpty || $0.rawValue.localizedCaseInsensitiveContains(search)
            })
        }.filter { !$0.destinations.isEmpty }
    }

    var body: some View {
        VStack(spacing: 14) {
            searchField.padding(.horizontal, 14)
            if model.unlocked {
                Button {
                    model.showProfile = true
                } label: {
                    HStack(spacing: 10) {
                        if let profile = model.currentProfile {
                            OperatorAvatar(profile: profile, engine: model.engine, size: 30)
                        } else {
                            Image(systemName: "person.crop.circle")
                                .font(.system(size: 26))
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        Text(model.operatorName)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(model.status["locked"].bool)
                .padding(.horizontal, 14)
            }

            List(selection: $selection) {
                ForEach(visibleSections, id: \.title) { section in
                    Section {
                        ForEach(section.destinations) { destination in
                            HStack(spacing: 10) {
                                Image(systemName: destination.symbol)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: destination == .groups ? 16 : 14, height: 13)
                                    .foregroundStyle(.white)
                                    .frame(width: 22, height: 22)
                                    .background(destination.iconColor.opacity(0.86), in: .rect(cornerRadius: 6))
                                    .accessibilityHidden(true)
                                Text(destination.rawValue)
                            }
                            .padding(.vertical, 3)
                            .tag(destination)
                        }
                    } header: {
                        Text(section.title)
                            .padding(.top, section.title == visibleSections.first?.title ? 0 : 12)
                    }
                }
                if visibleSections.isEmpty {
                    Text("No matching sections").foregroundStyle(.secondary)
                }
            }
            .listStyle(.sidebar)
            .tint(.gray)
        }
        .padding(.top, 12)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Search Stați", text: $query)
                .textFieldStyle(.plain)
            if !query.isEmpty {
                Button("Clear Search", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(.quaternary, in: .capsule)
    }
}

extension View {
    @ViewBuilder func statiActionStyle(prominent: Bool = false) -> some View {
        if #available(macOS 26.0, *) {
            if prominent { buttonStyle(.glassProminent) }
            else { buttonStyle(.glass) }
        } else {
            if prominent { buttonStyle(.borderedProminent) }
            else { buttonStyle(.bordered) }
        }
    }
}

struct SettingsPaneHeader: View {
    let title: String
    let subtitle: String
    let symbol: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 46, height: 46)
                .background(.quaternary, in: .rect(cornerRadius: 12))
                .accessibilityHidden(true)
            Text(title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text(subtitle).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .frame(maxWidth: 390)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
    }
}

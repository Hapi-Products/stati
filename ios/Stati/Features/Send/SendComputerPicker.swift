import SwiftUI
import UIKit

struct SendComputerPicker: View {
    @Environment(AppStore.self) private var store
    let receivers: [APIRecord]
    let statusKnown: Bool
    let addComputer: () -> Void

    private var selected: APIRecord? { store.computers.first { $0.id == store.selectedComputer } }

    var body: some View {
        VStack(spacing: 1) {
            Text("Send").font(.headline).foregroundStyle(.primary).accessibilityAddTraits(.isHeader)
            computerMenu
        }
        .frame(minHeight: 44)
    }

    private var computerMenu: some View {
        @Bindable var store = store
        return Menu {
            if !store.computers.isEmpty {
                Picker("Computer", selection: $store.selectedComputer) {
                    ForEach(store.computers) { computer in
                        Label {
                            Text(computer.name + " · " + status(computer.id).title)
                        } icon: {
                            statusIcon(computer.id)
                        }
                        .tag(computer.id)
                    }
                }
                .pickerStyle(.inline)
                Divider()
            }
            Button("Add Computer", systemImage: "qrcode.viewfinder", action: addComputer)
        } label: {
            HStack(spacing: 5) {
                if let selected {
                    Circle()
                        .fill(Color(uiColor: status(selected.id).color))
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                }
                Text(selected?.name ?? "Choose a computer")
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
            }
            .font(.caption)
            .frame(minHeight: 22)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .tint(Color(uiColor: .secondaryLabel))
        .accessibilityLabel(selected.map { $0.name + ", " + status($0.id).title } ?? "Choose a computer")
        .accessibilityHint("Switch computers or scan a QR code to add one")
    }

    private func statusIcon(_ id: String) -> Image {
        let symbol = UIImage(systemName: "circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 9))
        guard let image = symbol?.withTintColor(status(id).color, renderingMode: .alwaysOriginal) else {
            return Image(systemName: "circle.fill")
        }
        return Image(uiImage: image).renderingMode(.original)
    }

    private func status(_ id: String) -> (title: String, color: UIColor) {
        guard statusKnown else { return ("Status unavailable", .secondaryLabel) }
        return receivers.contains { $0.id == id && $0["online"].flag }
            ? ("Online", .systemGreen)
            : ("Offline", .systemRed)
    }
}

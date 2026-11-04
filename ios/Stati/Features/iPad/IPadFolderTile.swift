import SwiftUI

struct IPadFolderTile: View {
    let name: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "folder.fill").font(.system(size: 54)).foregroundStyle(AppIconAppearance.shared.accent).frame(height: 76).accessibilityHidden(true)
            Text(name).font(.subheadline).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.center)
            Text("Group").font(.caption).foregroundStyle(Color.statiSecondary)
        }.frame(maxWidth: .infinity, minHeight: 142, alignment: .top).contentShape(.rect)
    }
}

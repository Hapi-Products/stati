import SwiftUI

struct MemberAvatar: View {
    let api: APIClient
    let path: String
    let initials: String
    var size: CGFloat = 36
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFill() }
            else { Text(initials).font(.caption.bold()).frame(maxWidth: .infinity, maxHeight: .infinity).background(.quaternary) }
        }.frame(width: size, height: size).clipShape(.circle).accessibilityHidden(true)
            .task(id: path) { image = nil; if !path.isEmpty, let data = try? await api.bytes(path) { image = UIImage(data: data) } }
    }
}

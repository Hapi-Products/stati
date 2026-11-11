import SwiftUI

struct IPadSongTile: View {
    let song: APIRecord
    var large = false
    var body: some View {
        let firstSlide = song["firstSlide"].text
        Text(firstSlide.isEmpty ? song.title : firstSlide)
            .font(large ? .callout.weight(.medium) : .footnote.weight(.medium))
            .multilineTextAlignment(.center).foregroundStyle(.white)
            .padding(16).frame(maxWidth: .infinity).frame(height: WorshipPreviewGrid.height(large: large))
            .background(.black, in: .rect(cornerRadius: 5))
            .contentShape(.rect).accessibilityHidden(true)
    }
}

enum WorshipPreviewGrid {
    static let spacing: CGFloat = 20
    static func width(large: Bool) -> CGFloat { large ? 206 : 152 }
    static func height(large: Bool) -> CGFloat { large ? 148 : 116 }
    static func columns(large: Bool, accessibility: Bool = false) -> [GridItem] {
        [GridItem(.adaptive(minimum: accessibility ? 280 : width(large: large)), spacing: spacing, alignment: .top)]
    }
}

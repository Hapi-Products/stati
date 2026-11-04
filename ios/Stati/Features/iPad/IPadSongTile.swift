import SwiftUI

struct IPadSongTile: View {
    let song: APIRecord
    var large = false
    var body: some View {
        Text(song["firstSlide"].text)
            .font(large ? .callout.weight(.medium) : .footnote.weight(.medium))
            .multilineTextAlignment(.center).foregroundStyle(.white)
            .padding(16).frame(maxWidth: .infinity).frame(height: large ? 148 : 116)
            .background(.black, in: .rect(cornerRadius: 5))
            .contentShape(.rect).accessibilityHidden(true)
    }
}

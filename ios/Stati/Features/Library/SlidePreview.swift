import SwiftUI

struct SlidePreview: View {
    let text: String
    var large = false
    var body: some View {
        ZStack { Color.black; Text(text).font(.custom("Arial-BoldMT", size: large ? 8 : 5)).foregroundStyle(.white).multilineTextAlignment(.center).padding(5).minimumScaleFactor(0.3) }
            .frame(width: large ? 128 : 80, height: large ? 72 : 45).clipShape(.rect(cornerRadius: 4)).accessibilityHidden(true)
    }
}

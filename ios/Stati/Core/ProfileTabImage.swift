import SwiftUI
import UIKit

@MainActor enum ProfileTabImage {
    static func make(data: Data, scale: CGFloat) -> UIImage? {
        guard let photo = UIImage(data: data) else { return nil }
        let renderer = ImageRenderer(content: Image(uiImage: photo).resizable().scaledToFill().frame(width: 28, height: 28).clipShape(.circle))
        renderer.scale = scale
        return renderer.uiImage?.withRenderingMode(.alwaysOriginal)
    }
}

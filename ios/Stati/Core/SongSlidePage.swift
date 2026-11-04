import SwiftUI

struct SongSlidePage: View {
    let text: String
    var size: SlideTextSize = .large
    var isEnding = false
    @ScaledMetric(relativeTo: .largeTitle) private var scale = 1.0
    private var lines: [String] { text.components(separatedBy: "\n") }
    private var lyrics: [String] { isEnding ? Array(lines.dropLast()) : lines }
    var body: some View {
        GeometryReader { geometry in
            let available = CGSize(width: max(1, geometry.size.width - 64), height: max(1, geometry.size.height - (isEnding ? 132 : 64)))
            let points = Self.fittedPoints(lines: lyrics, preferred: size.points * scale, available: available)
            VStack(spacing: 20) {
                VStack(spacing: 0) {
                    ForEach(Array(lyrics.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.system(size: points, weight: .medium)).lineLimit(1).minimumScaleFactor(0.01).frame(maxWidth: .infinity)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                if isEnding { Text(lines.last ?? "").font(.title2.weight(.medium)).lineLimit(1).minimumScaleFactor(0.5).padding(.bottom, 8) }
            }.foregroundStyle(.white).padding(.horizontal, 32).padding(.top, 32).padding(.bottom, 24)
                .frame(width: geometry.size.width, height: geometry.size.height).background(.black).accessibilityElement(children: .ignore).accessibilityLabel(text)
        }.background(.black)
    }
    /// Fit the existing line breaks together. Reading-size changes never repaginate lyrics.
    static func fittedPoints(lines: [String], preferred: CGFloat, available: CGSize) -> CGFloat {
        guard !lines.isEmpty else { return preferred }
        func fits(_ points: CGFloat) -> Bool {
            let font = UIFont.systemFont(ofSize: points, weight: .medium)
            return font.lineHeight * CGFloat(lines.count) <= max(1, available.height)
                && lines.allSatisfy { ($0 as NSString).size(withAttributes: [.font: font]).width <= max(1, available.width) }
        }
        if fits(preferred) { return preferred }
        // Font metrics have size-dependent rounding; measure the final font instead of scaling an estimate.
        var lower: CGFloat = 0.01, upper = preferred
        for _ in 0..<16 {
            let middle = (lower + upper) / 2
            if fits(middle) { lower = middle } else { upper = middle }
        }
        return lower
    }
}

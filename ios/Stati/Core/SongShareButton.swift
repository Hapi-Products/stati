import SwiftUI
import UIKit

struct SongShareButton: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var scaledSymbolSize = 24.0
    private var symbolSize: CGFloat { UIDevice.current.userInterfaceIdiom == .pad ? 24 : scaledSymbolSize }
    let text: String
    let prepare: @MainActor (SongExportKind) async throws -> URL
    let failure: @MainActor (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.image = shareImage()
        configuration.contentInsets = .zero // The reader supplies the full touch target; toolbar padding must not shrink the symbol.
        let button = UIButton(configuration: configuration); button.accessibilityLabel = "Share song"; button.showsMenuAsPrimaryAction = true
        context.coordinator.configure(button); return button
    }
    private func shareImage() -> UIImage? {
        guard let symbol = UIImage(systemName: "square.and.arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: symbolSize, weight: .regular)) else { return nil }
        let side = symbolSize
        let scale = min(side / symbol.size.width, side / symbol.size.height)
        let size = CGSize(width: symbol.size.width * scale, height: symbol.size.height * scale)
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            symbol.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }.withRenderingMode(.alwaysTemplate)
    }
    func updateUIView(_ button: UIButton, context: Context) { context.coordinator.parent = self; context.coordinator.configure(button) }
    static func present(_ file: URL, from anchor: UIView?) {
        guard let anchor, let root = anchor.window?.rootViewController else { SongExportFiles.remove(file); return }
        var presenter = root
        while let next = presenter.presentedViewController, !next.isBeingDismissed { presenter = next }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = share.popoverPresentationController {
            popover.sourceView = anchor
            popover.sourceRect = anchor.bounds
            popover.permittedArrowDirections = .up
        }
        share.completionWithItemsHandler = { _, _, _, _ in Task { @MainActor in SongExportFiles.remove(file) } }
        presenter.present(share, animated: true)
    }
    @MainActor final class Coordinator {
        var parent: SongShareButton
        private var working = false
        init(parent: SongShareButton) { self.parent = parent }
        func configure(_ button: UIButton) {
            let appearance: UITraitCollection = UITraitCollection(userInterfaceStyle: parent.colorScheme == .dark ? .dark : .light)
            let color = UIColor(AppIconAppearance.shared.accent).resolvedColor(with: appearance)
            button.configuration?.image = parent.shareImage()
            button.tintColor = color
            button.configuration?.baseForegroundColor = color
            button.isEnabled = !working
            let exports = SongExportKind.allCases.map { kind in
                UIAction(title: kind.title, image: UIImage(systemName: kind.symbol)) { [weak self, weak button] _ in
                    guard let self, let button else { return }; self.share(kind, button: button)
                }
            }
            button.menu = UIMenu(children: exports + [UIAction(title: "Copy text", image: UIImage(systemName: "doc.on.doc")) { [weak self] _ in UIPasteboard.general.string = self?.parent.text }])
        }
        private func share(_ kind: SongExportKind, button: UIButton) {
            guard !working else { return }; working = true; button.isEnabled = false
            button.configuration?.showsActivityIndicator = true
            Task { @MainActor [weak self, weak button] in
                guard let self else { return }
                defer { self.working = false; button?.isEnabled = true; button?.configuration?.showsActivityIndicator = false }
                do {
                    let file = try await self.parent.prepare(kind)
                    SongShareButton.present(file, from: button)
                } catch is CancellationError { }
                catch { self.parent.failure(error.localizedDescription) }
            }
        }
    }
}

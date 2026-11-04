import UIKit

@MainActor enum SharePopoverPlacement {
    /// Keep the native Share button anchor; an upward arrow places its menu below it.
    static func configure(_ controller: UIViewController, traits: UITraitCollection) {
        guard traits.userInterfaceIdiom == .pad, traits.horizontalSizeClass == .regular,
              let activity = controller as? UIActivityViewController,
              let popover = activity.popoverPresentationController,
              popover.sourceItem != nil || popover.sourceView != nil else { return }
        popover.permittedArrowDirections = .up
    }
}

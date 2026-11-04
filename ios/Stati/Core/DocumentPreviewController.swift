import QuickLook

final class DocumentPreviewController: QLPreviewController {
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        hideSearch(in: self)
        let accent = UIColor(named: "AccentColor") ?? .systemBlue
        for item in (navigationItem.leftBarButtonItems ?? []) + (navigationItem.rightBarButtonItems ?? []) + (toolbarItems ?? []) {
            let label = item.accessibilityLabel ?? item.title ?? ""
            if ["Search", "Find"].contains(where: { label.localizedCaseInsensitiveCompare($0) == .orderedSame }) { item.isHidden = true }
            item.tintColor = accent
            // Public bar-item styling keeps Quick Look's own actions and Markup editor.
            if item.style != .prominent { item.style = .prominent }
        }
    }
    private func hideSearch(in controller: UIViewController) {
        let item = controller.navigationItem
        if item.searchController != nil { item.searchController = nil }
        if !item.searchBarPlacementBarButtonItem.isHidden { item.searchBarPlacementBarButtonItem.isHidden = true }
        let groups = item.leadingItemGroups + item.centerItemGroups + item.trailingItemGroups
        let buttons = (item.leftBarButtonItems ?? []) + (item.rightBarButtonItems ?? []) + (controller.toolbarItems ?? []) + groups.flatMap(\.barButtonItems)
        for button in buttons {
            let label = button.accessibilityLabel ?? button.title ?? ""
            if ["Search", "Find"].contains(where: { label.localizedCaseInsensitiveCompare($0) == .orderedSame }), !button.isHidden { button.isHidden = true }
        }
        for child in controller.children { hideSearch(in: child) }
    }
    override func present(_ controller: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {
        SharePopoverPlacement.configure(controller, traits: traitCollection)
        super.present(controller, animated: animated, completion: completion)
    }
}

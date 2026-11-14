import SwiftUI
import UIKit

enum WorshipGuideTarget: Hashable {
    case fallback, readingFormat, textSize, selectorSetting, songSelector, pageCounter, focus, linkNotes, groupSwitcher, serviceRefresh
}

enum WorshipHelpTopic {
    case settings, reader(hasPages: Bool, following: Bool, canLink: Bool), browse, groups, service

    struct Step {
        let target: WorshipGuideTarget
        let title: String
        let instruction: String
    }

    var wikiURL: URL {
        let page: String
        switch self {
        case .settings: page = "Worship-Settings"
        case .reader: page = "Song-Reader"
        case .browse: page = "iPadOS#browse-songs"
        case .groups: page = "iPadOS#worship-groups"
        case .service: page = "iPadOS#services"
        }
        return URL(string: "https://github.com/Hapi-Products/stati/wiki/" + page)!
    }

    var steps: [Step] {
        switch self {
        case .settings:
            [
                Step(target: .readingFormat, title: "Choose a reading format", instruction: "Use this picker to open songs as slides, a PDF, or text."),
                Step(target: .textSize, title: "Set slide text size", instruction: "Drag the slider to the size you want. The reader uses it for slides."),
                Step(target: .selectorSetting, title: "Choose where the song selector looks", instruction: "Pick Recents or Current service. If there’s no active service, it shows Recents.")
            ]
        case .reader(let hasPages, let following, let canLink):
            readerSteps(hasPages: hasPages, following: following, canLink: canLink)
        case .browse:
            [
                Step(target: .fallback, title: "Browse your song library", instruction: "Tap a first-slide preview to open the song. Use the magnifying glass to search by title or lyrics, or tap the clock for Recents."),
                Step(target: .fallback, title: "Check live service status", instruction: "The dot is gray with no active service, red when you’re waiting or disconnected, and green when live. Tap it for details.")
            ]
        case .groups:
            [
                Step(target: .fallback, title: "Open a shared file", instruction: "Tap a file preview to open it. To find a file already linked to a song, open the song and tap Notes."),
                Step(target: .groupSwitcher, title: "Switch worship groups", instruction: "If you have access to several groups, tap the people icon to switch. Set your default in Account → Worship.")
            ]
        case .service:
            [
                Step(target: .fallback, title: "Read from the running order", instruction: "Tap a song in the service to open it. Use Song Selector in the reader to move between songs in the order. The ready check shows which songs are saved on this iPad."),
                Step(target: .serviceRefresh, title: "Refresh the running order", instruction: "Tap the refresh icon to fetch the latest service. Use the person icon when it appears to lead or leave the service.")
            ]
        }
    }

    private func readerSteps(hasPages: Bool, following: Bool, canLink: Bool) -> [Step] {
        var steps = [
            Step(target: .fallback, title: "Read the song your way", instruction: "Open Reader options (•••) for Slides, PDF document, or Text. The book icon in this guide opens the full Song Reader wiki.")
        ]
        if following {
            steps.append(Step(target: .fallback, title: "Follow the leader", instruction: "The reader changes songs and pages with your leader. Manual page and song controls are unavailable while you follow."))
        } else {
            steps.append(Step(target: .songSelector, title: "Switch songs", instruction: "Tap the music-list icon for Recents or the current service. Set its source in Features."))
            if hasPages {
                steps.append(Step(target: .pageCounter, title: "Jump to a page", instruction: "Use the arrows to turn one page at a time. On songs with multiple pages, tap or hold the page counter and pick a preview."))
            }
        }
        if canLink {
            steps.append(Step(target: .linkNotes, title: "Link a file", instruction: "Tap Notes → Link a file, then pick a shared file. Open Notes again to read or unlink it."))
        }
        steps.append(Step(target: .focus, title: "Focus on the song", instruction: "Tap the diagonal arrows at the lower right to hide reader controls. Tap them again to bring the controls back."))
        return steps
    }
}

@MainActor final class WorshipGuide: NSObject, UIPopoverPresentationControllerDelegate {
    private final class Anchor {
        weak var view: UIView?
        init(_ view: UIView) { self.view = view }
    }

    private var anchors: [WorshipGuideTarget: Anchor] = [:]
    private var topic: WorshipHelpTopic?
    private weak var popover: UIViewController?
    private var presentationID = UUID()
    private var spotlight: UIView?

    func register(_ view: UIView, at target: WorshipGuideTarget) {
        anchors[target] = Anchor(view)
    }

    func start(_ topic: WorshipHelpTopic) {
        guard popover == nil else { return }
        self.topic = topic
        present(step: 0)
    }

    func stop() {
        presentationID = UUID()
        topic = nil
        clearSpotlight()
        popover?.dismiss(animated: true)
        popover = nil
    }

    func move(to position: Int) {
        guard let topic, topic.steps.indices.contains(position), let popover else { return }
        let id = UUID()
        presentationID = id
        self.popover = nil
        clearSpotlight()
        popover.dismiss(animated: true) { [weak self] in
            guard let self, self.presentationID == id else { return }
            self.present(step: position)
        }
    }

    private func present(step position: Int) {
        guard let topic, topic.steps.indices.contains(position) else { return }
        let stepTarget = topic.steps[position].target
        let candidate = stepTarget == .fallback ? nil : anchors[stepTarget]?.view
        let target = candidate.flatMap { $0.window != nil && !$0.bounds.isEmpty ? $0 : nil }
        guard let source = target ?? anchors[.fallback]?.view,
              let window = source.window,
              var presenter = window.rootViewController else { return }

        while let next = presenter.presentedViewController, !next.isBeingDismissed {
            presenter = next
        }

        let width = min(310, window.bounds.width - 48)
        let view = WorshipGuidePopover(guide: self, topic: topic, position: position, width: width)
        let controller = UIHostingController(rootView: view)
        controller.modalPresentationStyle = .popover
        let size = controller.sizeThatFits(in: CGSize(width: width, height: window.bounds.height))
        controller.preferredContentSize = CGSize(width: width, height: size.height)
        guard let presentation = controller.popoverPresentationController else { return }
        presentation.sourceView = source
        if target != nil {
            presentation.sourceRect = source.bounds
        } else {
            presentation.sourceRect = CGRect(x: source.bounds.midX, y: source.bounds.midY, width: 1, height: 1)
            presentation.permittedArrowDirections = []
        }
        presentation.delegate = self
        popover = controller
        if let target {
            let highlight = WorshipGuideSpotlight(source: target, frame: presenter.view.bounds, outlineColor: UIColor(AppIconAppearance.shared.accent))
            spotlight = highlight
            presenter.view.addSubview(highlight)
        }
        presenter.present(controller, animated: true)
    }

    func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle {
        .none
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard popover === presentationController.presentedViewController else { return }
        popover = nil
        topic = nil
        clearSpotlight()
    }

    private func clearSpotlight() {
        spotlight?.removeFromSuperview()
        spotlight = nil
    }
}

private final class WorshipGuideSpotlight: UIView {
    private weak var source: UIView?
    private let shade = CAShapeLayer()
    private let outline = CAShapeLayer()
    private let outlineColor: UIColor

    init(source: UIView, frame: CGRect, outlineColor: UIColor) {
        self.source = source
        self.outlineColor = outlineColor
        super.init(frame: frame)
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shade.fillRule = .evenOdd
        shade.fillColor = UIColor.black.withAlphaComponent(0.22).cgColor
        outline.fillColor = UIColor.clear.cgColor
        outline.lineWidth = 2
        layer.addSublayer(shade)
        layer.addSublayer(outline)
        if !UIAccessibility.isReduceMotionEnabled {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.52
            pulse.duration = 1.25
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            outline.add(pulse, forKey: "pulse")
        }
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let source, source.window != nil else { return }
        let rect = source.convert(source.bounds, to: self).insetBy(dx: -4, dy: -3)
        let target = UIBezierPath(roundedRect: rect, cornerRadius: 10)
        let surrounding = UIBezierPath(rect: bounds)
        surrounding.append(target)
        shade.path = surrounding.cgPath
        outline.path = target.cgPath
        outline.strokeColor = outlineColor.resolvedColor(with: traitCollection).cgColor
    }
}

extension View {
    @ViewBuilder func worshipGuide(_ guide: WorshipGuide?, at target: WorshipGuideTarget) -> some View {
        if let guide {
            overlay {
                WorshipGuideAnchor(guide: guide, target: target)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        } else {
            self
        }
    }
}

private struct WorshipGuideAnchor: UIViewRepresentable {
    let guide: WorshipGuide
    let target: WorshipGuideTarget

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        guide.register(view, at: target)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guide.register(view, at: target)
    }
}

private struct WorshipGuidePopover: View {
    let guide: WorshipGuide
    let topic: WorshipHelpTopic
    let position: Int
    let width: CGFloat

    private var tint: Color { AppIconAppearance.shared.accent }

    var body: some View {
        let step = topic.steps[position]
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Text(step.title).font(.headline).accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Link(destination: topic.wikiURL) {
                    Label("Read the full wiki guide", systemImage: "book")
                        .labelStyle(.iconOnly)
                }.foregroundStyle(tint).frame(minWidth: 44, minHeight: 32)
                Button("Close guide", systemImage: "xmark") { guide.stop() }
                    .labelStyle(.iconOnly).foregroundStyle(.primary).frame(minWidth: 40, minHeight: 32)
            }
            Text(step.instruction).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                if topic.steps.count > 1 {
                    Text("\(position + 1) of \(topic.steps.count)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Previous step", systemImage: "chevron.left") { guide.move(to: position - 1) }
                        .labelStyle(.iconOnly).buttonStyle(.bordered).disabled(position == 0)
                } else {
                    Spacer()
                }
                if position + 1 < topic.steps.count {
                    Button("Next step", systemImage: "chevron.right") { guide.move(to: position + 1) }
                        .labelStyle(.iconOnly).buttonStyle(.bordered)
                } else {
                    Button("Finish guide", systemImage: "checkmark") { guide.stop() }
                        .labelStyle(.iconOnly).buttonStyle(.borderedProminent)
                }
            }.controlSize(.regular)
        }
        .padding(16)
        .frame(width: width)
        .tint(tint)
    }
}

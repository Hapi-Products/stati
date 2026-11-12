import SwiftUI
import UIKit

enum WorshipGuideTarget: Hashable {
    case readingFormat, textSize, selectorSetting, songSelector, pageCounter, groupSwitcher, serviceRefresh
}

enum WorshipHelpTopic {
    case settings, reader(hasPages: Bool), groups, service

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
        case .groups, .service: page = "iPadOS"
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
        case .reader(let hasPages):
            [Step(target: .songSelector, title: "Switch songs", instruction: "Tap this icon to open the list of recent songs or the current service’s running order.")]
            + (hasPages ? [Step(target: .pageCounter, title: "Jump to a slide", instruction: "Tap or touch and hold the page counter to open the previews. Tap an image to jump to that slide.")] : [])
        case .groups:
            [Step(target: .groupSwitcher, title: "Switch worship groups", instruction: "Tap the people icon and choose a group. Your default group is set in Account → Worship.")]
        case .service:
            [Step(target: .serviceRefresh, title: "Refresh the running order", instruction: "Tap the refresh icon to fetch the latest service. Use the person icon when it appears to lead or leave the service.")]
        }
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
        popover?.dismiss(animated: true)
        popover = nil
    }

    func move(to position: Int) {
        guard let topic, topic.steps.indices.contains(position), let popover else { return }
        let id = UUID()
        presentationID = id
        self.popover = nil
        popover.dismiss(animated: true) { [weak self] in
            guard let self, self.presentationID == id else { return }
            self.present(step: position)
        }
    }

    private func present(step position: Int) {
        guard let topic, topic.steps.indices.contains(position),
              let source = anchors[topic.steps[position].target]?.view,
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
        presentation.sourceRect = source.bounds
        presentation.delegate = self
        popover = controller
        presenter.present(controller, animated: true)
    }

    func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle {
        .none
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard popover === presentationController.presentedViewController else { return }
        popover = nil
        topic = nil
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

    var body: some View {
        let step = topic.steps[position]
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Text(step.title).font(.headline).accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Link(destination: topic.wikiURL) {
                    Label("Read the full wiki guide", systemImage: "book")
                        .labelStyle(.iconOnly)
                }.frame(minWidth: 44, minHeight: 32)
                Button("Close guide", systemImage: "xmark") { guide.stop() }
                    .labelStyle(.iconOnly).frame(minWidth: 40, minHeight: 32)
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
                        .labelStyle(.iconOnly).buttonStyle(.borderedProminent)
                } else {
                    Button("Finish guide", systemImage: "checkmark") { guide.stop() }
                        .labelStyle(.iconOnly).buttonStyle(.borderedProminent)
                }
            }.controlSize(.regular)
        }
        .padding(16)
        .frame(width: width)
    }
}

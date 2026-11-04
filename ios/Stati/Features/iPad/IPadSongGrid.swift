import SwiftUI
import UIKit

/// A continuous document grid with UIKit's native alphabet index.
struct IPadSongGrid: UIViewRepresentable {
    let songs: [APIRecord]
    let large: Bool
    let open: (APIRecord) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> UICollectionView {
        let layout = UICollectionViewFlowLayout(); layout.minimumInteritemSpacing = 20; layout.minimumLineSpacing = 20; layout.sectionInset = UIEdgeInsets(top: 16, left: 20, bottom: 24, right: 36)
        let view = UICollectionView(frame: .zero, collectionViewLayout: layout)
        view.register(UICollectionViewCell.self, forCellWithReuseIdentifier: "song")
        view.backgroundColor = .systemBackground; view.alwaysBounceVertical = true
        view.dataSource = context.coordinator; view.delegate = context.coordinator
        return view
    }
    func updateUIView(_ view: UICollectionView, context: Context) {
        let changed = context.coordinator.parent.songs != songs || context.coordinator.parent.large != large
        context.coordinator.parent = self
        if changed { view.reloadData(); view.collectionViewLayout.invalidateLayout() }
    }
    @MainActor final class Coordinator: NSObject, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
        var parent: IPadSongGrid
        init(parent: IPadSongGrid) { self.parent = parent }
        func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { parent.songs.count }
        func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
            let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "song", for: indexPath), song = parent.songs[indexPath.item]
            cell.contentConfiguration = UIHostingConfiguration { IPadSongTile(song: song, large: parent.large) }.margins(.all, 0)
            cell.isAccessibilityElement = true; cell.accessibilityLabel = song.title; cell.accessibilityTraits = .button
            return cell
        }
        func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { collectionView.deselectItem(at: indexPath, animated: true); parent.open(parent.songs[indexPath.item]) }
        func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
            let available = max(1, collectionView.bounds.width - collectionView.adjustedContentInset.left - collectionView.adjustedContentInset.right - 56), minimum: CGFloat = parent.large ? 206 : 152
            let columns = max(1, floor((available + 20) / (minimum + 20)))
            return CGSize(width: floor((available - (columns - 1) * 20) / columns), height: parent.large ? 148 : 116)
        }
        func indexTitles(for collectionView: UICollectionView) -> [String]? { SongAlphabet.sections(parent.songs).map(\.id) }
        func collectionView(_ collectionView: UICollectionView, indexPathForIndexTitle title: String, at index: Int) -> IndexPath {
            let firstID = SongAlphabet.sections(parent.songs).first(where: { $0.id == title })?.songs.first?.id
            return IndexPath(item: parent.songs.firstIndex(where: { $0.id == firstID }) ?? 0, section: 0)
        }
    }
}

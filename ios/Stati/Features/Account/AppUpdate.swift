import Foundation

struct AppUpdate: Identifiable {
    struct Highlight: Identifiable {
        let title: String
        let detail: String
        let icon: String
        var id: String { title }
    }
    let id: Int
    let title: String
    let highlights: [Highlight]
    let details: [String]
    static let current = AppUpdate(id: 50, title: "Developer Mode and Diagnostics", highlights: [
        Highlight(title: "Try Siri in Stazi Beta", detail: "Enable Developer Mode in Features on iOS or iPadOS 27.3 or later.", icon: "hammer"),
        Highlight(title: "Review recent errors", detail: "Diagnostics keeps 24 hours of errors. Use the copy button at the top to copy the log.", icon: "stethoscope")
    ], details: [])
    static let previous: [AppUpdate] = [
        AppUpdate(id: 49, title: "Put a song in the running order", highlights: [
        Highlight(title: "Save a song to a service", detail: "Use Siri or the song menu, choose a service, drag the song into place and tap Done.", icon: "text.badge.plus"),
        Highlight(title: "Check Siri AI availability", detail: "Diagnostics explains which device requirements are met.", icon: "stethoscope")
    ], details: []),
        AppUpdate(id: 48, title: "Simpler page controls", highlights: [
        Highlight(title: "Move through songs", detail: "The arrows and page counter share one glass control.", icon: "arrow.left.and.right"),
        Highlight(title: "Set the slide text size", detail: "Tap the slider track or drag the thumb to adjust the size.", icon: "textformat.size"),
        Highlight(title: "See recent songs and files", detail: "Recents has one toolbar action to clear your history.", icon: "clock")
    ], details: ["The beta is identified by its app name and uses a fixed icon and accent."]),
        AppUpdate(id: 47, title: "Stazi Beta", highlights: [], details: ["The development app uses a fixed icon and accent. Recents shows your history without a search bar."]),
        AppUpdate(id: 46, title: "Simpler settings and support", highlights: [
        Highlight(title: "Find Siri in Features", detail: "Open Features in Stați for Siri and reading controls. Apple Settings keeps the beta preference and app information.", icon: "gearshape"),
        Highlight(title: "Start fresh in Recents", detail: "Clear your iPad’s history while keeping your songs and files.", icon: "trash"),
        Highlight(title: "Review diagnostics", detail: "See recent errors, copy a report, or open a draft on GitHub.", icon: "stethoscope")
    ], details: ["Switch worship groups inside Groups.", "PDF Layout has its own controls.", "The account header shows your photo and name."]),
        AppUpdate(id: 45, title: "Clearer controls on iPad", highlights: [
        Highlight(title: "Find the right control", detail: "Help opens beside the control you need, with arrows to move through the guide.", icon: "questionmark.circle"),
        Highlight(title: "Adjust reading size smoothly", detail: "Features puts six song controls in two columns. The slide text slider moves continuously.", icon: "textformat.size"),
        Highlight(title: "Keep services and groups in place", detail: "Open groups and services inside their own tabs. Service leadership and refresh now have toolbar icons.", icon: "calendar")
    ], details: ["On iPad, the gear opens Apple Settings from Features.", "The book icon in a guide opens its full wiki page.", "Switching tabs clears the temporary group or service detail.", "The current update and its build number are listed in What’s New."]),
        AppUpdate(id: 43, title: "Simpler Features and Siri search", highlights: [], details: ["Features now has its own page in Apple Settings on iPad.", "Clicker is an on/off switch.", "Enable Siri AI Song Search to open matching songs on a supported device."]),
        AppUpdate(id: 42, title: "Worship settings and guides", highlights: [], details: ["Worship preferences can be changed inside Stați or in Apple Settings on iPad.", "Added guides for Worship settings and the song reader."]),
        AppUpdate(id: 40, title: "A cleaner song library", highlights: [], details: ["Removed Hymnary from iPhone and iPad.", "The Send queue is available on iPhone."]),
        AppUpdate(id: 34, title: "Quicker song and computer controls", highlights: [
        Highlight(title: "Switch worship groups", detail: "When you have more than one group, use the people icon on the left of Groups.", icon: "person.2"),
        Highlight(title: "Select and send lyrics", detail: "On iPhone, double-tap lyrics to select a passage. The correction keyboard has Romanian accent keys.", icon: "text.cursor"),
        Highlight(title: "See which computer is online", detail: "Tap the computer name under Send to switch or add a computer.", icon: "desktopcomputer")
    ], details: ["The music-list icon opens Song Selector on iPad.", "After sending a song, you can keep a copy for today. The computer’s saved-file receipt keeps the copy available long-term."]),
        AppUpdate(id: 27, title: "QR invitations", highlights: [
            Highlight(title: "Invite with a scan", detail: "Show a joining QR on your computer or iPhone. New members scan it to create an account, then wait for approval.", icon: "qrcode")
        ], details: ["Administrator invitations show a QR and expiry, without a separate six-digit code.", "New-computer pairing links now work in Add computer.", "Six-digit codes still connect to computers already set up.", "Pairing asks for confirmation and stops if your signed-in account changes."]),
        AppUpdate(id: 26, title: "Connect new computers", highlights: [
        Highlight(title: "Pair from your phone", detail: "Scan a new computer’s pairing QR in Stați, then confirm to register it with your account.", icon: "qrcode.viewfinder")
    ], details: ["New-computer pairing links now work in Add computer.", "Six-digit codes still connect to computers already set up.", "Pairing asks for confirmation and stops if your signed-in account changes."]),
        AppUpdate(id: 24, title: "Corrections and Service", highlights: [
        Highlight(title: "Point out each correction", detail: "Select separate passages on iPhone, then tap any selected lyrics to change that correction.", icon: "text.bubble"),
        Highlight(title: "A place for your service", detail: "Open Service on iPad for the running order. Move between its songs from the reader’s Running order menu.", icon: "list.number")
    ], details: ["Full song lyrics scroll with the comment page, without a second scrolling box.", "Each selected passage keeps its own suggested correction.", "Service stays separate from Browse and remembers the song you opened.", "Page controls keep turning pages within the current song.", "Service details remain read-only on iPad."]),
        AppUpdate(id: 23, title: "Updates on your iPad", highlights: [
        Highlight(title: "See what’s new on iPad", detail: "New app builds show their highlights automatically. You can turn this off in Reading & Features.", icon: "sparkles"),
        Highlight(title: "Worship settings together", detail: "Find your default group, shared groups and team members in Account → Worship.", icon: "person.2")
    ], details: ["App icon previews no longer clip while swiping.", "Song actions follow accessibility text sizing together.", "The iPad update setting does not disable iPhone update pages."]),
        AppUpdate(id: 22, title: "Songs stay together", highlights: [
        Highlight(title: "Keep the final lyrics in view", detail: "Amen stays with the last lyrics, and larger slide text keeps the same lines together.", icon: "music.note.list"),
        Highlight(title: "Connect with your camera", detail: "Scan a computer QR code in Stați, or enter its code below the camera.", icon: "qrcode.viewfinder")
    ], details: ["Computer code controls use native Liquid Glass.", "Slide backgrounds return to dark after viewing a PDF.", "Original lyrics and shared exports remain unchanged."]),
        AppUpdate(id: 21, title: "Invites and your colors", highlights: [
        Highlight(title: "Invite from your phone", detail: "Administrators can show a joining QR code and code, even with the computer closed.", icon: "qrcode"),
        Highlight(title: "Your icon, your color", detail: "Choose from five icons in Account. Stați’s accent follows your applied choice.", icon: "app.badge"),
        Highlight(title: "Clearer song reading", detail: "Song PDFs fill a white screen, with matching song controls on iPhone.", icon: "doc.text")
    ], details: ["Find App icon below Account on iPhone Profile, or in Reading & Features on iPad.", "Scan computer QR codes in the app.", "Administrators can see when their joining code changes.", "Unlink managed shared notes without deleting the group file.", "Fixed an accent-color rendering crash.", "Administrators can open an invite beside a computer in Computers. New members still need approval.", "PDF pages remain fully visible, without dark areas around the paper.", "The iPhone song reader balances Comment, Share and Notes, with a larger Share symbol."]),
        AppUpdate(id: 19, title: "Songs and reading", highlights: [
        Highlight(title: "Songs without the wait", detail: "Browse saved songs right away while offline PDFs save in the background.", icon: "arrow.down.doc"),
        Highlight(title: "More room for the lyrics", detail: "Song actions sit together at the bottom, leaving the title clear above.", icon: "music.note.list"),
        Highlight(title: "Your Stați icon", detail: "Choose from six looks for your Home Screen.", icon: "app.badge")
    ], details: ["Choose Blue, White, Gold, Green, Greyscale or Red in Account → App icon.", "Larger song batches reduce library requests.", "The iPad task panel resizes smoothly, with its actions in the top toolbar.", "The Stați name returns to the iPad sidebar, with your account below.", "iPhone stays in portrait; iPad supports portrait and landscape."]),
        AppUpdate(id: 18, title: "Songs, ready offline", highlights: [], details: ["Loaded songs stay available offline, with PDFs in Files → Stați → Songs.", "Authors appear beside tasks, with names inside their details.", "Saved changes refresh across devices.", "Comment on songs with text, images and selected lyrics.", "Commenters and Pastors cannot use the iPad app for now.", "iPhone stays in portrait."]),
        AppUpdate(id: 15, title: "Songs and groups, simplified", highlights: [], details: ["Named worship groups with selected members.", "Song notes and Share in the top bar.", "Task changes refresh while you work.", "Slides, PDF or text and an alphabetical song browser on iPad."]),
        AppUpdate(id: 14, title: "Songs, page by page", highlights: [], details: ["Songs and linked notes in one reader.", "Glass page controls for songs and file galleries.", "The new blue Stați icon."]),
        AppUpdate(id: 13, title: "A clearer iPad workspace", highlights: [], details: ["One file viewer with Apple Markup.", "Vertical tasks with updated changes.", "Automatic library loading and a default computer setting."]),
        AppUpdate(id: 12, title: "Files and Markup", highlights: [], details: ["Apple Markup for original images and PDFs.", "Recents, Groups, Browse and Tasks on iPad.", "Task images, two per row."]),
        AppUpdate(id: 9, title: "Clearer tasks", highlights: [], details: ["Inline task images.", "Swipe left to delete, right to move.", "Compact details and comments, with image removal separate from opening."]),
        AppUpdate(id: 8, title: "Your song, with your notes", highlights: [], details: ["Link shared group files to songs.", "Open linked notes from a service song.", "Unlinking preserves the shared original."]),
        AppUpdate(id: 7, title: "A simpler iPhone app", highlights: [], details: ["A smaller Profile header.", "Privacy and What’s New inside the app.", "Keep browsing after cancelling search.", "A simpler send list and group file form.", "Clearer selected tab icons."])
    ]
}

import SwiftUI

struct PrivacyView: View {
    var body: some View {
        List {
                Section { Text("Stați is managed by Hapi Products.") }
                section("Accounts", "We store your first name, last initial, optional photo, approval status, and passkey public credentials. Your private passkey stays on your device.")
                section("Files", "Cloudflare temporarily stores files for delivery. Files are removed after delivery acknowledgement or by hourly cleanup after their 24-hour expiry. Downloads and email drafts on the computer remain until the operator manages them. Delivery status, filenames and rejection reasons remain online for seven days; the computer keeps its own delivery record.")
                section("Songs and services", "The paired computer shares a catalog containing song titles, lyrics and first-slide text. Approved worship roles, choir directors, pastors and administrators can browse the catalog. Authorized worship roles and administrators can plan services. These shared records stay in Stați until managed or the service is retired; removing a computer revokes access. Original presentation files stay on the PC.")
                section("Shared group files", "Chord sheets and lyric images shared with the ministry team remain available until their uploader or an administrator removes the shared copy. Group members can open the files shared with their groups. Administrators can open files across all groups.")
                section("Feedback and tasks", "Tasks and notes are shared with approved team members. Your name is shown with submissions and replies. These records remain until managed by the church team.")
                section("PC tools", "Conversion and OCR happen only in the Windows companion. No AI provider receives your files. Automatic clock contrast samples the screen locally without saving or uploading it.")
                section("Access", "Church administrators manage membership and computers. Essential cookies remember passcode access and sign-in. The computer displays a changing code for new account setup. Existing passkey members can sign in while the computer is offline.")
                section("Diagnostics", "Stați keeps connection and server errors on this device for 24 hours. If you send a report, the support team receives your description, app information and up to 200 recent errors in a private GitHub inbox. The diagnostic entries contain the time, app area and error type.")
                section("Account removal", "Contact your church administrator to correct your account details or request removal.")
        }.listStyle(.insetGrouped).textSelection(.enabled).navigationTitle("Privacy").navigationBarTitleDisplayMode(.inline)
    }
    private func section(_ title: String, _ body: String) -> some View {
        Section(title) {
            Text(body).foregroundStyle(.secondary)
        }
    }
}

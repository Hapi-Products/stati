# Stați Worship for iPad

**Updated on** November 13, 2026 · **Updated by** Codex for Stați

Stați Worship brings together **Browse**, **Groups**, and **Service**. The computer you select and your church role determine the material you can open.

In development build 73, the top tabs use text. Open the sidebar to see the same destinations with their names and icons. Reader and file actions use icons.

## Read songs during a service

1. Open **Service** and choose the plan for the service.
2. Tap a song to open it in the reader. Use the page controls to move through the song.
3. Open the page counter to pick from slide previews. Use the song selector to jump to another song.
4. Return to **Service** to see the running order again. Use **Browse** when you need to search by title or lyrics.

## Browse songs

Tap the first-slide preview to open a song, or use the magnifying glass to search by title or lyrics. For live service details, tap the status dot in the toolbar. The gray dot stays neutral even if your app accent is blue.

Tap the clock in **Browse** to open **Recents**. Tap the music-list icon to return to the library. Song Selector can still open recent songs directly.

When you search during an active service, results that match the exact version in the running order appear first under **In this service**. Compare the first slide and language to tell similar versions apart.

**Recents** is a quick way back to a song or file you already opened. Tap the trash icon and confirm **Yes, clear recents** to clear this iPad’s history. Songs, files and offline copies stay on the device.

## Worship groups

Open **Groups** and look at the top left for the current group’s name. If you can access multiple worship groups, tap the name to choose a specific group. The choices are based on your group access. Administrators can choose any worship group. Tap a file preview to open it. To change the default group, use **Account → Worship**.

To share an image, open the **+** menu and choose **Choose from Photos**. Pick a photo, check the preview and group, and tap the share icon. Use **Choose PDF or image** for files or **Scan Document** for paper charts. Find unfinished group drafts under **Saved group drafts** in the add menu.

If you can manage notes, open a song and choose **Reader options (•••) → Link shared notes** to attach an eligible shared file. [Link a shared file](https://github.com/Hapi-Products/stati/wiki/Song-Reader#link-a-shared-file)

## Send a song file for service review

1. In **Service**, open the plan and tap **Song requests and uploads** under the running order.
2. Enter the title and choose **Upload song file**. If Google Drive is enabled in Apple’s Files app, browse to **Google Drive** and choose the file from your music folder. [Set up Google Drive in Files](https://support.apple.com/en-ca/102238)
3. After the presentation computer receives the attachment, tap **Submit song request** for review. Check the request’s status in the same view.

Files opens your selected document from Drive. A direct Google Drive folder connection for the presentation computer is a separate feature.

## Lead or follow a live service

1. Select the same presentation computer and worship group as the leader. The service must be active on that computer.
2. As the leader, open **Service**, select the active service, and tap a song in its running order. Confirm **Yes, Lead** when Stați asks. If the prompt does not appear, open **Browse**, tap the live status dot, and choose **Lead service**. If you belong to multiple worship groups, choose the group in that same menu first.
3. On another iPad in the group, open Stați. It opens the current song and follows page changes. Close the live reader to browse on your own. Tap **Back to Live** (the radio-wave icon) to return to the leader’s current song and page. The button is also available while viewing another song or a group file.
4. The indicator is green when connected, red when the active service is waiting for a leader or the connection is unavailable, and gray when there is no active service for the selected group.

Stați sends the song, page and reader format. Each iPad renders it locally. PDF page turns use the leader’s selected transition, subject to Reduce Motion. Keep the leader’s app open during the service.

With build 58 and the updated server, the leader can turn pages from an iPhone signed in to the same profile. Start leading on the iPad and open the song as Slides or PDF first. [Use iPhone as a live clicker](https://github.com/Hapi-Products/stati/wiki/iPhone#use-iphone-as-a-live-clicker)

Build 59 makes the status dot larger and gives the Help button its own Liquid Glass surface in Browse, Groups, Service and the song reader.

Build 60 lets the iPad react to a live page turn as soon as a change arrives from Stați. The reader checks periodically if the live connection drops.

The server update prepared with development build 62 shortens the requests that fetch the current live page and load a newly opened song.

### Lead a song without an active service

In build 59, open any song from **Browse** and tap the **Lead song** icon (the person with sound waves) in the reader toolbar. Choose your worship group if asked. Eligible leaders must belong to the group. The group can follow the song and the leader’s iPhone can turn its pages. Tap the stop icon to end the session and close the song. Closing the reader with the X also ends a standalone song you were leading. The reader toolbar uses icons.

### Hide the status bar in Focus

Tap the diagonal arrows at the bottom right of a song to enter Focus. It hides the status bar by default. To keep the clock and battery visible, turn off **Hide status bar in Focus** in **Account → Features**.

## Add a song in order

In the song reader, open the menu and choose **Add to service**, or use the Siri shortcut. Pick an active service, drag the song into place and tap **Done**. The selected computer sees the updated order in its shared plan. [Siri and Shortcuts](https://github.com/Hapi-Products/stati/wiki/Siri-and-Shortcuts)

## Services

### Prepare the set

Open the service and look for **Ready check**. It shows which versions of the songs are saved on this iPad. Expand **Songs to save** to see what is missing. Tap **Prepare set for offline use** to download the songs and save the running order. An updated server and phone report whether the leader’s clicker is connected during an active service.

In development build 64, **Changes since preparation** shows additions with a green plus and removals with a red minus. A replacement shows the old and new entries. A move shows both positions. Tap **Update saved set** to save the new order and download the song versions that are missing. Use **Clicker Test** in the same section to receive rehearsal pages from the phone.

If the iPad loses internet access, open **Service** to find saved running orders. Open one to read the prepared songs. The offline copy is for reading. Live following and clicker commands require a connection.


Open a service to see its running order in the Service tab. Use the refresh icon in the navigation bar for the latest order. The person icon appears when your role allows you to lead, take over, or leave leadership. Use the back arrow to return to the service list. Switching tabs closes the current service detail.

## Get help in the app

Use the question mark in Browse, Groups, a service, or the song reader for steps relevant to that screen. The book icon in each guide opens the matching wiki page or section.

## Remove a worship group

Open **Account → Worship → Groups**. If you own the group or are an administrator, swipe left on the group or touch and hold it, then choose **Remove group** and confirm. The group and its files disappear from members’ shared views. Stați retains the underlying records. The church’s member roster remains available under **Team members**.

## Change the iPad settings

Open your account, then **Features** for reader, library, and update controls or **Worship** for group choices. The account header shows your name and photo. Find the app version in **Settings → Apps → Stazi Beta** on the development build or **Settings → Apps → Stați Worship** on the regular build. In Stazi Beta, turn on **Developer Mode** in Features to use Stați shortcuts on iPadOS 27.3 or later. Open **Account → Diagnostics** inside Stați to review or copy the last 24 hours of errors. [Siri commands](https://github.com/Hapi-Products/stati/wiki/Siri-and-Shortcuts) · [Report a problem](https://github.com/Hapi-Products/stati/wiki/Troubleshooting#report-a-problem-on-iphone-or-ipad)

[Song reader tips](https://github.com/Hapi-Products/stati/wiki/Song-Reader) · [Worship settings walkthrough](https://github.com/Hapi-Products/stati/wiki/Worship-Settings) · [Tablet apps](https://github.com/Hapi-Products/stati/wiki/Tablet-Apps)

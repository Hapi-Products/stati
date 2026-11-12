import Testing
import Foundation
@testable import StatiCore

@Suite @MainActor struct ReaderPreferencesTests {
    @Test func iPadStartsWithSlidesAndPhoneNeverUsesClickerBindings() {
        let value = SongReaderSettings()
        #expect(value.mode == .slides)
        #expect(!value.clickerAllowed(onIPad: false))
        #expect(value.clickerAllowed(onIPad: true))
    }
    @Test func settingsPersistSeparatelyForEachAccount() {
        let suite = "stati-reader-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let a = ReaderPreferences(ownerID: "a", defaults: defaults)
        a.settings.mode = .document; a.settings.retention = .week; a.settings.clickerEnabled = false
        let reopened = ReaderPreferences(ownerID: "a", defaults: UserDefaults(suiteName: suite)!)
        #expect(reopened.settings.mode == .document)
        #expect(reopened.settings.retention == .week)
        #expect(!reopened.settings.clickerEnabled)
        #expect(ReaderPreferences(ownerID: "b", defaults: defaults).settings.mode == .slides)
    }
    @Test func inAppAndSystemSettingsShareOverridesAndKeepOtherSavedValues() throws {
        let suite = "stati-reader-mirror-" + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let saved = ReaderPreferences(ownerID: "a", defaults: defaults)
        saved.settings.slideSize = .extraLarge
        let inApp = ReaderPreferences(ownerID: "a", defaults: defaults, writesDeviceSettings: true)
        inApp.settings.pdfColumns = .two
        #expect(defaults.string(forKey: "stati.reader.pdfColumns") == "2")
        #expect(defaults.object(forKey: "stati.reader.slideSize") == nil)
        #expect(ReaderPreferences(ownerID: "b", defaults: defaults).settings.slideSize == .large)

        defaults.set("document", forKey: "stati.reader.mode")
        defaults.set("off", forKey: "stati.reader.clicker")
        inApp.reload()
        #expect(inApp.settings.mode == .document)
        #expect(!inApp.settings.clickerEnabled)
        #expect(inApp.settings.slideSize == .extraLarge)

        defaults.set("saved", forKey: "stati.reader.pdfColumns")
        inApp.reload()
        #expect(inApp.settings.pdfColumns == .one)
    }
    @Test func simplifiedSettingsMigrateStoredValuesAndUseTheSlider() throws {
        let suite = "stati-reader-slider-" + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let saved = ReaderPreferences(ownerID: "a", defaults: defaults)
        saved.settings.pdfColumns = .two
        saved.settings.clickerEnabled = false
        defaults.set("saved", forKey: "stati.reader.pdfColumns")
        defaults.set("extraLarge", forKey: "stati.reader.slideSize")
        defaults.set("currentService", forKey: "stati.reader.selectorSource")
        defaults.set(true, forKey: "stati.worship.songListAfterGridRestore")
        ReaderPreferences.prepareDeviceDefaults(ownerID: "a", defaults: defaults)

        #expect(defaults.string(forKey: "stati.reader.pdfColumns") == "2")
        #expect(defaults.string(forKey: "stati.reader.clicker") == "off")
        #expect(defaults.string(forKey: "stati.reader.libraryLayout") == "list")
        #expect(defaults.double(forKey: "stati.reader.slideScale") == 3)
        #expect(defaults.string(forKey: "stati.reader.selectorSource") == "currentService")

        defaults.set(0.75, forKey: "stati.reader.slideScale")
        ReaderPreferences.prepareDeviceDefaults(ownerID: "b", defaults: defaults)
        let inApp = ReaderPreferences(ownerID: "b", defaults: defaults, writesDeviceSettings: true)
        #expect(inApp.settings.slideSize.sliderPosition == 0.75)
        #expect(inApp.settings.slideSize.points == 34)
        inApp.settings.slideSize = .small
        #expect(defaults.double(forKey: "stati.reader.slideScale") == 0)
    }
    @Test func reduceMotionDisablesReaderTransitionsAndRetentionHasExactCutoffs() {
        for effect in ReaderTransition.allCases { #expect(effect.effective(reduceMotion: true) == .instant) }
        let now = Date(timeIntervalSince1970: 2_000_000)
        #expect(RecentRetention.never.cutoff(now: now) == nil)
        #expect(RecentRetention.day.cutoff(now: now) == now.addingTimeInterval(-86400))
        #expect(RecentRetention.week.cutoff(now: now) == now.addingTimeInterval(-7 * 86400))
        #expect(RecentRetention.fortnight.cutoff(now: now) == now.addingTimeInterval(-14 * 86400))
    }
}

struct DocumentOnlyTransitionTests {
    @Test func slidesAndTextNeverUseDocumentEffects() {
        for effect in ReaderTransition.allCases {
            #expect(effect.effective(for: .slides, reduceMotion: false) == .instant)
            #expect(effect.effective(for: .text, reduceMotion: false) == .instant)
            #expect(effect.effective(for: .document, reduceMotion: false) == effect)
            #expect(effect.effective(for: .document, reduceMotion: true) == .instant)
        }
    }
}

struct SlideSizeSettingsTests {
    @Test func earlierSettingsKeepModeAndPreferencesWhenSizeIsAdded() throws {
        let bytes = Data("{\"mode\":\"document\",\"transition\":\"pageTurn\",\"clickerEnabled\":false,\"largePreviews\":true,\"retention\":7}".utf8)
        let settings = try JSONDecoder().decode(SongReaderSettings.self, from: bytes)
        #expect(settings.mode == .document && settings.transition == .pageTurn)
        #expect(!settings.clickerEnabled && settings.largePreviews && settings.retention == .week)
        #expect(settings.slideSize == .large)
    }
    @Test func currentSizesKeepFractionalPositionsAndReadOlderPresetNames() throws {
        let previous = try JSONDecoder().decode(SlideTextSize.self, from: Data(#""extraLarge""#.utf8))
        #expect(previous == .extraLarge)
        let current = try #require(SlideTextSize(sliderPosition: 2.5))
        #expect(current.points == 56)
        #expect(try JSONDecoder().decode(SlideTextSize.self, from: JSONEncoder().encode(current)) == current)
    }
    @Test func slideSizesHaveIncreasingReadableSteps() {
        #expect(SlideTextSize.small.points < SlideTextSize.standard.points)
        #expect(SlideTextSize.standard.points < SlideTextSize.large.points)
        #expect(SlideTextSize.large.points < SlideTextSize.extraLarge.points)
    }
}

@Suite struct PDFColumnSettingsTests {
    @Test func olderSettingsDefaultToOneColumnAndTwoColumnsPersist() throws {
        let old = try JSONDecoder().decode(SongReaderSettings.self, from: Data("{\"mode\":\"document\",\"slideSize\":\"extraLarge\"}".utf8))
        #expect(old.pdfColumns == .one)
        var newer = old; newer.pdfColumns = .two
        #expect(try JSONDecoder().decode(SongReaderSettings.self, from: JSONEncoder().encode(newer)).pdfColumns == .two)
        #expect(old.selectorSource == .recents)
        newer.selectorSource = .currentService
        #expect(try JSONDecoder().decode(SongReaderSettings.self, from: JSONEncoder().encode(newer)).selectorSource == .currentService)
    }
}

import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif
#if canImport(AppIntents)
import AppIntents
#endif

// Shared by the app and the Live Activity extension (ios/App/ForgeLiveActivity): the project already includes this file
// in both targets. Nothing here touches HealthKit.

#if canImport(ActivityKit)
@available(iOS 16.2, *)
public struct ForgeLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// A date such that `Text(timerStart, style: .timer)` shows the active time (pauses already taken out).
        public var timerStart: Date
        /// Active seconds, frozen while paused.
        public var elapsed: Double
        public var paused: Bool
        public var activeKcal: Int
        public var totalKcal: Int
        public var distanceMeters: Double
        public var avgPace: String
        public var heartRate: Int

        public init(timerStart: Date, elapsed: Double, paused: Bool, activeKcal: Int, totalKcal: Int, distanceMeters: Double, avgPace: String, heartRate: Int) {
            self.timerStart = timerStart; self.elapsed = elapsed; self.paused = paused
            self.activeKcal = activeKcal; self.totalKcal = totalKcal
            self.distanceMeters = distanceMeters; self.avgPace = avgPace; self.heartRate = heartRate
        }
    }

    public var title: String      // "Jog in place", "Walk", "Run"
    public var showsDistance: Bool
    public var useMiles: Bool

    public init(title: String, showsDistance: Bool, useMiles: Bool) {
        self.title = title; self.showsDistance = showsDistance; self.useMiles = useMiles
    }
}
#endif

#if canImport(AppIntents)
/// The Pause / Resume button on the lock screen and in the Dynamic Island. A LiveActivityIntent runs in the app's process,
/// so it reaches the same HKWorkoutSession the screen is using.
@available(iOS 17.0, *)
public struct ForgeTogglePauseIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Pause or resume workout"
    public init() {}
    public func perform() async throws -> some IntentResult {
        await ForgeLiveBridge.togglePause?()
        return .result()
    }
}
#endif

/// The app sets this when a live workout starts; the intent calls it. Stays nil in the extension process (the intent
/// runs in the app because it is a LiveActivityIntent).
public enum ForgeLiveBridge {
    public static var togglePause: (() async -> Void)?
}

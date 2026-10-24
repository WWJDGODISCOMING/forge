import Foundation
import HealthKit
#if canImport(ActivityKit)
import ActivityKit
#endif

// One live cardio workout on the iPhone: an HKWorkoutSession + HKLiveWorkoutBuilder (iPhone support starts in iOS 26)
// that Apple Health sees as it happens, plus an optional lock-screen Live Activity. Driven by ForgeWorkoutsPlugin
// (startLive / pauseLive / resumeLive / endLive / liveState). Every failure reports back to JS; the JS timer keeps
// going and the workout is simply kept in Forge only. JS side: js/native/live-workout.js.

@available(iOS 26.0, *)
final class ForgeLiveWorkout: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    private let store: HKHealthStore
    private let kcalUnit = HKUnit.kilocalorie()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var id = ""
    private var weightKg = 0.0
    private var indoor = true
    private var title = ""
    private var showsDistance = false
    private var useMiles = true
    private var lastActivityPush = Date.distantPast
    private var paused = false
    // The real pause / resume moments from the session delegate. The WebView hears nothing while the app is in the
    // background, so a pause + resume on the lock screen is only known here; JS reads these back (liveState / endLive).
    private let pauseLock = NSLock()
    private var pauseStart: Date?
    private var pauseLog: [(start: Date, end: Date)] = []
    #if canImport(ActivityKit)
    private var activity: Any? // Activity<ForgeLiveAttributes>, kept untyped so this file compiles below iOS 16.2
    #endif
    /// Sends {paused, at, kcal, distanceM, hr, elapsed, pauses, pausedAt} to JS.
    var onUpdate: (([String: Any]) -> Void)?

    init(store: HKHealthStore) { self.store = store }

    // Set the moment end() starts and cleared by cleanup(): while an end is in flight the workout is not "running", so a
    // second endLive (or the JS reconcile) resolves [:] instead of ending the same builder twice.
    private var ending = false

    var isRunning: Bool { session != nil && !ending }

    // MARK: start

    func start(id: String, type: HKWorkoutActivityType, indoor: Bool, start: Date, weightKg: Double, title: String, showsDistance: Bool, useMiles: Bool) async throws -> Bool {
        if session != nil || ending { throw NSError(domain: "Forge", code: 1, userInfo: [NSLocalizedDescriptionKey: "A workout is already running."]) }
        let config = HKWorkoutConfiguration()
        config.activityType = type
        config.locationType = indoor ? .indoor : .outdoor
        let session = try HKWorkoutSession(healthStore: store, configuration: config)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
        session.delegate = self
        builder.delegate = self
        self.id = id; self.weightKg = weightKg; self.indoor = indoor; self.title = title
        self.showsDistance = showsDistance; self.useMiles = useMiles
        self.session = session; self.builder = builder; self.paused = false
        pauseLock.lock(); pauseStart = nil; pauseLog = []; pauseLock.unlock()
        session.prepare() // gets the sensors ready before the clock starts
        session.startActivity(with: start)
        try await builder.beginCollection(at: start)
        let hasActivity = startActivity()
        ForgeLiveBridge.togglePause = { [weak self] in self?.togglePause() }
        return hasActivity
    }

    // MARK: pause / resume

    func pause() { guard let s = session, s.state == .running else { return }; s.pause() }
    func resume() { guard let s = session, s.state == .paused else { return }; s.resume() }
    func togglePause() { if session?.state == .paused { resume() } else { pause() } }

    // MARK: numbers

    private func stats() -> (kcal: Double, meters: Double, hr: Double?, elapsed: Double) {
        var kcal = 0.0, meters = 0.0
        var hr: Double? = nil
        if let b = builder {
            if let t = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) { kcal = b.statistics(for: t)?.sumQuantity()?.doubleValue(for: kcalUnit) ?? 0 }
            for id in [HKQuantityTypeIdentifier.distanceWalkingRunning] {
                if let t = HKQuantityType.quantityType(forIdentifier: id) { meters += b.statistics(for: t)?.sumQuantity()?.doubleValue(for: .meter()) ?? 0 }
            }
            if let t = HKQuantityType.quantityType(forIdentifier: .heartRate) {
                hr = b.statistics(for: t)?.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            }
            return (kcal, meters, hr, b.elapsedTime)
        }
        return (kcal, meters, hr, 0)
    }

    private func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

    /// Closed pauses as [{start, end}] in ms, plus the start of one still open. `closeAt` closes an open pause (used at the end).
    private func pauseInfo(closeAt: Date? = nil) -> (list: [[String: Double]], open: Double?) {
        pauseLock.lock(); defer { pauseLock.unlock() }
        var list = pauseLog.map { ["start": ms($0.start), "end": ms($0.end)] }
        var open: Double? = nil
        if let p = pauseStart {
            if let c = closeAt { list.append(["start": ms(p), "end": ms(max(c, p))]) } else { open = ms(p) }
        }
        return (list, open)
    }

    func snapshot() -> [String: Any] {
        let s = stats()
        let p = pauseInfo()
        var out: [String: Any] = ["id": id, "paused": paused, "at": ms(Date()), "kcal": s.kcal, "distanceM": s.meters, "elapsed": s.elapsed * 1000, "pauses": p.list]
        if let hr = s.hr { out["hr"] = hr }
        if let o = p.open { out["pausedAt"] = o }
        return out
    }

    // MARK: delegates

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        if toState == .paused || toState == .running {
            paused = toState == .paused
            pauseLock.lock()
            if toState == .paused { if pauseStart == nil { pauseStart = date } }
            else if let p = pauseStart { pauseLog.append((p, date)); pauseStart = nil }
            pauseLock.unlock()
            var snap = snapshot()
            snap["at"] = date.timeIntervalSince1970 * 1000
            DispatchQueue.main.async { self.onUpdate?(snap); self.pushActivity(force: true) }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        var snap = snapshot()
        snap["failed"] = true // the screen says "Kept in Forge only" and its own clock carries on
        DispatchQueue.main.async { self.onUpdate?(snap) }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let snap = snapshot()
        DispatchQueue.main.async { self.onUpdate?(snap); self.pushActivity(force: false) }
    }

    // MARK: end

    /// Ends the session. save == false throws the workout away. Returns what to put on the Forge row.
    func end(save: Bool, fallbackKcal: Double, endDate: Date) async throws -> [String: Any] {
        guard !ending, let session = session, let builder = builder else { return [:] }
        ending = true
        defer { cleanup() }
        session.end()
        let closed = pauseInfo(closeAt: endDate).list
        if !save {
            // Nothing goes to Apple Health, but JS still gets the phone's own clock and numbers for the Forge row.
            try? await builder.endCollection(at: endDate)
            let st = stats()
            builder.discardWorkout()
            return ["elapsed": st.elapsed * 1000, "elapsedMs": st.elapsed * 1000, "pauses": closed, "kcal": st.kcal, "distanceM": st.meters]
        }
        // iPhone alone often measures no active energy: fall back to the estimate JS passed in so the rings still move.
        let before = stats()
        if before.kcal <= 0, fallbackKcal > 0, let t = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            let s = HKQuantitySample(type: t, quantity: HKQuantity(unit: kcalUnit, doubleValue: fallbackKcal), start: builder.startDate ?? endDate.addingTimeInterval(-60), end: endDate, device: .local(),
                                     metadata: [HKMetadataKeySyncIdentifier: "forge:live:\(id):kcal", HKMetadataKeySyncVersion: 1, "ForgeWorkoutId": id])
            try? await builder.addSamples([s])
        }
        try await builder.addMetadata([
            HKMetadataKeyExternalUUID: id,
            HKMetadataKeySyncIdentifier: "forge:live:" + id,
            HKMetadataKeySyncVersion: 1,
            HKMetadataKeyIndoorWorkout: indoor,
            "ForgeWorkoutId": id,
        ])
        try await builder.endCollection(at: endDate)
        let end = stats()
        var hrAvg: Double? = nil, hrMax: Double? = nil
        if let t = HKQuantityType.quantityType(forIdentifier: .heartRate), let st = builder.statistics(for: t) {
            let u = HKUnit.count().unitDivided(by: .minute())
            hrAvg = st.averageQuantity()?.doubleValue(for: u)
            hrMax = st.maximumQuantity()?.doubleValue(for: u)
        }
        guard let workout = try await builder.finishWorkout() else { throw NSError(domain: "Forge", code: 2, userInfo: [NSLocalizedDescriptionKey: "Couldn't save the workout."]) }
        var out: [String: Any] = ["uuid": workout.uuid.uuidString, "kcal": end.kcal > 0 ? end.kcal : fallbackKcal, "distanceM": end.meters, "elapsedMs": end.elapsed * 1000, "pauses": closed]
        if let a = hrAvg { out["avgHr"] = a }
        if let m = hrMax { out["maxHr"] = m }
        return out
    }

    private func cleanup() {
        endActivity()
        ForgeLiveBridge.togglePause = nil
        session = nil; builder = nil; paused = false; ending = false
        pauseLock.lock(); pauseStart = nil; pauseLog = []; pauseLock.unlock()
    }

    // MARK: Live Activity (lock screen + Dynamic Island)

    /// True only when the ForgeLiveActivity extension is in the app: without it there would be nothing to draw.
    private func extensionInstalled() -> Bool {
        guard let dir = Bundle.main.builtInPlugInsURL,
              let items = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return false }
        return items.contains { $0.hasSuffix(".appex") && $0.contains("ForgeLive") }
    }

    private func state() -> Any? {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return nil }
        let s = stats()
        let ms = s.elapsed
        let total = s.kcal + (weightKg > 0 ? weightKg * ms / 3600 : 0)
        let miles = s.meters / 1609.344
        let perUnit = useMiles ? miles : s.meters / 1000
        var pace = "--'--\""
        if s.meters >= 30, perUnit > 0 { let p = Int((ms / perUnit).rounded()); pace = "\(p / 60)'" + String(format: "%02d", p % 60) + "\"" }
        return ForgeLiveAttributes.ContentState(timerStart: Date().addingTimeInterval(-ms), elapsed: ms, paused: paused, activeKcal: Int(s.kcal.rounded()), totalKcal: Int(total.rounded()),
                                                distanceMeters: s.meters, avgPace: pace, heartRate: Int((s.hr ?? 0).rounded()))
        #else
        return nil
        #endif
    }

    private func startActivity() -> Bool {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *), extensionInstalled(), ActivityAuthorizationInfo().areActivitiesEnabled,
              let st = state() as? ForgeLiveAttributes.ContentState else { return false }
        let attrs = ForgeLiveAttributes(title: title, showsDistance: showsDistance, useMiles: useMiles)
        do {
            activity = try Activity<ForgeLiveAttributes>.request(attributes: attrs, content: .init(state: st, staleDate: nil), pushType: nil)
            return true
        } catch { return false }
        #else
        return false
        #endif
    }

    private func pushActivity(force: Bool) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *), let a = activity as? Activity<ForgeLiveAttributes>, let st = state() as? ForgeLiveAttributes.ContentState else { return }
        if !force && Date().timeIntervalSince(lastActivityPush) < 2 { return } // the timer runs itself; numbers can lag a moment
        lastActivityPush = Date()
        Task { await a.update(.init(state: st, staleDate: nil)) }
        #endif
    }

    private func endActivity() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *), let a = activity as? Activity<ForgeLiveAttributes> else { return }
        let st = state() as? ForgeLiveAttributes.ContentState
        Task { await a.end(st.map { .init(state: $0, staleDate: nil) }, dismissalPolicy: .immediate) }
        activity = nil
        #endif
    }
}

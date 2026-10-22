import Foundation
import Capacitor
import HealthKit

// Saves finished Forge workouts to Apple Health (an HKWorkout with active-energy samples) and finds Apple Watch
// workouts that overlap one. The capgo health plugin stays in charge of all other reads. Every HealthKit call
// reports back to JS with reject(), never crashes. JS side: js/native/workouts-health.js.

private let forgeBundleId = "com.christianeverett.forge"

@objc(ForgeWorkoutsPlugin)
public class ForgeWorkoutsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ForgeWorkoutsPlugin"
    public let jsName = "ForgeWorkouts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "overlappingWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activeEnergySum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteWorkout", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private let kcalUnit = HKUnit.kilocalorie()

    private func date(_ v: Any?) -> Date? {
        if let n = v as? Double { return Date(timeIntervalSince1970: n / 1000) }
        if let n = v as? Int { return Date(timeIntervalSince1970: Double(n) / 1000) }
        if let s = v as? String {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = f.date(from: s) { return d }
            f.formatOptions = [.withInternetDateTime]
            return f.date(from: s)
        }
        return nil
    }

    private func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    private func statusName(_ s: HKAuthorizationStatus) -> String {
        switch s {
        case .sharingAuthorized: return "authorized"
        case .sharingDenied: return "denied"
        default: return "notDetermined"
        }
    }

    private func activityType(_ name: String?) -> HKWorkoutActivityType {
        switch name {
        case "functionalStrengthTraining": return .functionalStrengthTraining
        case "mixedCardio": return .mixedCardio
        default: return .traditionalStrengthTraining
        }
    }

    // MARK: requestAuthorization

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health isn't available on this device."); return }
        guard let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
              let hr = HKObjectType.quantityType(forIdentifier: .heartRate) else { call.reject("Missing HealthKit types."); return }
        let workout = HKObjectType.workoutType()
        store.requestAuthorization(toShare: [workout, energy], read: [workout, energy, hr]) { [weak self] _, error in
            guard let self = self else { return }
            if let error = error { call.reject(error.localizedDescription); return }
            call.resolve([
                "workout": self.statusName(self.store.authorizationStatus(for: workout)),
                "energy": self.statusName(self.store.authorizationStatus(for: energy)),
            ])
        }
    }

    // MARK: saveWorkout

    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health isn't available on this device."); return }
        guard let id = call.getString("id"), !id.isEmpty,
              let start = date(call.options["start"]), let end = date(call.options["end"]), end > start,
              let energyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("Missing id, start or end."); return
        }
        let version = call.getInt("version") ?? 1
        let kcal = max(0, call.getDouble("kcal") ?? 0)
        let indoor = call.getBool("indoor") ?? true
        var pauses: [(Date, Date)] = []
        for p in (call.getArray("pauses") as? [[String: Any]]) ?? [] {
            if let a = date(p["start"]), let b = date(p["end"]), b > a, a >= start, b <= end { pauses.append((a, b)) }
        }
        pauses.sort { $0.0 < $1.0 }

        let config = HKWorkoutConfiguration()
        config.activityType = activityType(call.getString("activityType"))
        config.locationType = indoor ? .indoor : .outdoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())

        let meta: [String: Any] = [
            HKMetadataKeyExternalUUID: id,
            HKMetadataKeySyncIdentifier: "forge:" + id,
            HKMetadataKeySyncVersion: version,
            HKMetadataKeyIndoorWorkout: indoor,
            "ForgeWorkoutId": id,
        ]

        builder.beginCollection(withStart: start) { [weak self] ok, error in
            guard let self = self else { return }
            if !ok { call.reject(error?.localizedDescription ?? "Couldn't start the workout."); return }
            let samples = self.energySamples(id: id, version: version, type: energyType, kcal: kcal, start: start, end: end, pauses: pauses)
            var events: [HKWorkoutEvent] = []
            for (a, b) in pauses {
                events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: a, duration: 0), metadata: nil))
                events.append(HKWorkoutEvent(type: .resume, dateInterval: DateInterval(start: b, duration: 0), metadata: nil))
            }
            func finish() {
                builder.addMetadata(meta) { ok, error in
                    if !ok { builder.discardWorkout(); call.reject(error?.localizedDescription ?? "Couldn't add details."); return }
                    builder.endCollection(withEnd: end) { ok, error in
                        if !ok { builder.discardWorkout(); call.reject(error?.localizedDescription ?? "Couldn't end the workout."); return }
                        builder.finishWorkout { workout, error in
                            guard let workout = workout else { call.reject(error?.localizedDescription ?? "Couldn't save the workout."); return }
                            call.resolve(["uuid": workout.uuid.uuidString])
                        }
                    }
                }
            }
            func addEvents() {
                if events.isEmpty { finish(); return }
                builder.addWorkoutEvents(events) { ok, error in
                    if !ok { builder.discardWorkout(); call.reject(error?.localizedDescription ?? "Couldn't add pauses."); return }
                    finish()
                }
            }
            if samples.isEmpty { addEvents(); return }
            builder.add(samples) { ok, error in
                if !ok { builder.discardWorkout(); call.reject(error?.localizedDescription ?? "Couldn't add calories."); return }
                addEvents()
            }
        }
    }

    /// About one sample per minute across the active time (pauses left out); the pieces add up to `kcal`.
    private func energySamples(id: String, version: Int, type: HKQuantityType, kcal: Double, start: Date, end: Date, pauses: [(Date, Date)]) -> [HKQuantitySample] {
        if kcal <= 0 { return [] }
        var spans: [(Date, Date)] = []
        var cursor = start
        for (a, b) in pauses {
            if a > cursor { spans.append((cursor, a)) }
            cursor = max(cursor, b)
        }
        if end > cursor { spans.append((cursor, end)) }
        var pieces: [(Date, Date)] = []
        for (a, b) in spans {
            let len = b.timeIntervalSince(a)
            let n = max(1, Int((len / 60).rounded()))
            for k in 0..<n {
                let s = a.addingTimeInterval(len * Double(k) / Double(n))
                let e = a.addingTimeInterval(len * Double(k + 1) / Double(n))
                pieces.append((s, e))
            }
        }
        let total = pieces.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) }
        if total <= 0 { return [] }
        var left = kcal
        var out: [HKQuantitySample] = []
        for (idx, p) in pieces.enumerated() {
            let share = idx == pieces.count - 1 ? left : kcal * p.1.timeIntervalSince(p.0) / total
            left -= share
            if share <= 0 { continue }
            // Each piece carries its own sync identifier + version so a re-save replaces it in place (no doubled calories).
            let meta: [String: Any] = [
                HKMetadataKeySyncIdentifier: "forge:\(id):kcal:\(idx)",
                HKMetadataKeySyncVersion: version,
                "ForgeWorkoutId": id,
            ]
            out.append(HKQuantitySample(type: type, quantity: HKQuantity(unit: kcalUnit, doubleValue: share), start: p.0, end: p.1, device: .local(), metadata: meta))
        }
        return out
    }

    // MARK: overlappingWorkouts

    @objc func overlappingWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["workouts": []]); return }
        guard let start = date(call.options["start"]), let end = date(call.options["end"]) else { call.reject("Missing start or end."); return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 50, sortDescriptors: nil) { [weak self] _, results, error in
            guard let self = self else { return }
            if let error = error { call.reject(error.localizedDescription); return }
            let found = (results as? [HKWorkout] ?? []).filter { w in
                let src = w.sourceRevision.source.bundleIdentifier
                let ours = w.metadata?["ForgeWorkoutId"] != nil
                return src != forgeBundleId && !ours && w.endDate > start && w.startDate < end
            }
            if found.isEmpty { call.resolve(["workouts": []]); return }
            let group = DispatchGroup()
            let lock = NSLock()
            var out: [[String: Any]] = []
            for w in found {
                group.enter()
                self.workoutStats(w) { kcal, hr in
                    var row: [String: Any] = [
                        "uuid": w.uuid.uuidString,
                        "sourceName": w.sourceRevision.source.name,
                        "sourceId": w.sourceRevision.source.bundleIdentifier,
                        "start": self.iso(w.startDate),
                        "end": self.iso(w.endDate),
                    ]
                    if let kcal = kcal { row["kcal"] = kcal }
                    if let hr = hr { row["avgHr"] = hr }
                    lock.lock(); out.append(row); lock.unlock()
                    group.leave()
                }
            }
            group.notify(queue: .main) { call.resolve(["workouts": out]) }
        }
        store.execute(query)
    }

    private func workoutStats(_ w: HKWorkout, _ done: @escaping (Double?, Double?) -> Void) {
        var kcal: Double? = nil
        if #available(iOS 16.0, *),
           let t = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
           let q = w.statistics(for: t)?.sumQuantity() {
            kcal = q.doubleValue(for: kcalUnit)
        } else if let total = w.totalEnergyBurned {
            kcal = total.doubleValue(for: kcalUnit)
        }
        guard let hrType = HKObjectType.quantityType(forIdentifier: .heartRate) else { done(kcal, nil); return }
        let unit = HKUnit.count().unitDivided(by: .minute())
        let q = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: HKQuery.predicateForObjects(from: w), options: .discreteAverage) { _, stats, _ in
            done(kcal, stats?.averageQuantity()?.doubleValue(for: unit))
        }
        store.execute(q)
    }

    // MARK: activeEnergySum

    @objc func activeEnergySum(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let t = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else { call.resolve(["kcal": 0]); return }
        guard let start = date(call.options["start"]), let end = date(call.options["end"]) else { call.reject("Missing start or end."); return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let q = HKStatisticsQuery(quantityType: t, quantitySamplePredicate: predicate, options: .cumulativeSum) { [weak self] _, stats, _ in
            // An error here usually means "no data": treat it as zero measured energy.
            call.resolve(["kcal": stats?.sumQuantity()?.doubleValue(for: self?.kcalUnit ?? .kilocalorie()) ?? 0])
        }
        store.execute(q)
    }

    // MARK: deleteWorkout

    @objc func deleteWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["deleted": false]); return }
        guard let s = call.getString("uuid"), let uuid = UUID(uuidString: s) else { call.reject("Missing uuid."); return }
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: HKQuery.predicateForObject(with: uuid), limit: 1, sortDescriptors: nil) { [weak self] _, results, error in
            guard let self = self else { return }
            if let error = error { call.reject(error.localizedDescription); return }
            guard let w = (results as? [HKWorkout])?.first else { call.resolve(["deleted": false]); return } // already gone
            if w.sourceRevision.source.bundleIdentifier != forgeBundleId { call.reject("That workout wasn't saved by Forge."); return }
            // The workout's own energy samples first (the link is gone once the workout is), then the workout.
            let finishDelete = {
                self.store.delete(w) { ok, error in
                    if let error = error { call.reject(error.localizedDescription); return }
                    call.resolve(["deleted": ok])
                }
            }
            guard let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else { finishDelete(); return }
            self.store.deleteObjects(of: energy, predicate: HKQuery.predicateForObjects(from: w)) { _, _, _ in finishDelete() }
        }
        store.execute(query)
    }
}

import WidgetKit
import SwiftUI

// Home-screen and lock-screen widgets. They read the small numbers-only snapshot the app stores (ForgeWidgetShared.swift)
// and never go online. Numbers from another day or older than a day are not shown: the widget says "Open Forge to update".
// No advice or judging words, just the numbers. Taps open Forge on the matching screen (forge://open/<route>).

private let ringWeigh = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.243, green: 0.784, blue: 0.941, alpha: 1) : UIColor(red: 0.0, green: 0.42, blue: 0.56, alpha: 1) })
private let ringSteps = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.55, green: 0.86, blue: 0.35, alpha: 1) : UIColor(red: 0.20, green: 0.50, blue: 0.10, alpha: 1) })
private let ringProtein = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 1.0, green: 0.72, blue: 0.30, alpha: 1) : UIColor(red: 0.70, green: 0.38, blue: 0.0, alpha: 1) })
private let widgetBackground = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.016, green: 0.043, blue: 0.055, alpha: 1) : UIColor(red: 0.96, green: 0.98, blue: 0.99, alpha: 1) })

private func localDay(_ d: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
}

private func number(_ n: Int) -> String { n.formatted(.number.grouping(.automatic)) }

struct ForgeWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: ForgeWidgetSnapshot?
    /// Numbers to show, or nil when there are none or they are out of date.
    var fresh: ForgeWidgetSnapshot? {
        guard let s = snapshot, !s.isStale(at: date, today: localDay(date)) else { return nil }
        return s
    }
}

struct ForgeWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ForgeWidgetEntry { ForgeWidgetEntry(date: Date(), snapshot: ForgeWidgetProvider.sample) }
    func getSnapshot(in context: Context, completion: @escaping (ForgeWidgetEntry) -> Void) {
        completion(ForgeWidgetEntry(date: Date(), snapshot: context.isPreview ? ForgeWidgetProvider.sample : ForgeWidgetStore.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ForgeWidgetEntry>) -> Void) {
        let now = Date()
        let snap = ForgeWidgetStore.load()
        var dates = [now]
        if let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now)) { dates.append(tomorrow) } // the new day: numbers go stale at midnight
        if let s = snap {
            let staleAt = Date(timeIntervalSince1970: s.at / 1000 + ForgeWidgetSnapshot.staleAfter + 1)
            if staleAt > now { dates.append(staleAt) }
        }
        completion(Timeline(entries: dates.sorted().map { ForgeWidgetEntry(date: $0, snapshot: snap) }, policy: .after(now.addingTimeInterval(6 * 3600))))
    }

    static let sample = ForgeWidgetSnapshot(v: 1, at: Date().timeIntervalSince1970 * 1000, day: localDay(Date()), weigh: true,
        steps: ForgeWidgetProgress(v: 6200, goal: 8000), protein: ForgeWidgetProgress(v: 90, goal: 140), kcal: ForgeWidgetProgress(v: 1400, goal: 2100),
        trend: ForgeWidgetTrend(unit: "lb", latest: 181.4, points: [183.0, 182.6, 182.5, 182.1, 181.9, 181.6, 181.4]))
}

// MARK: pieces

private struct RingArc: View {
    let fraction: Double
    let color: Color
    var line: CGFloat = 7
    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.25), lineWidth: line)
            Circle().trim(from: 0, to: max(0.001, fraction)).stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}

private struct LabeledRing: View {
    let label: String
    let value: String
    let fraction: Double
    let color: Color
    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                RingArc(fraction: fraction, color: color)
                Text(value).font(.system(.caption2, design: .rounded).weight(.bold)).minimumScaleFactor(0.5).lineLimit(1).padding(.horizontal, 6)
            }
            .aspectRatio(1, contentMode: .fit)
            Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) \(value)")
    }
}

private struct RingsRow: View {
    let s: ForgeWidgetSnapshot
    var body: some View {
        HStack(spacing: 8) {
            LabeledRing(label: "Weigh-in", value: s.weigh ? "Done" : "Not yet", fraction: s.weigh ? 1 : 0, color: ringWeigh)
            LabeledRing(label: "Steps", value: s.steps?.v.map { number($0) } ?? "–", fraction: s.steps?.fraction ?? 0, color: ringSteps)
            LabeledRing(label: "Protein", value: s.protein.map { "\($0.v ?? 0) g" } ?? "–", fraction: s.protein?.fraction ?? 0, color: ringProtein)
        }
    }
}

private struct KcalLine: View {
    let kcal: ForgeWidgetProgress?
    var body: some View {
        if let k = kcal {
            Text("\(number(k.v ?? 0)) of \(number(k.goal)) cal").font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

private struct Sparkline: View {
    let points: [Double]
    var body: some View {
        GeometryReader { geo in
            let lo = points.min() ?? 0, hi = points.max() ?? 1
            let span = max(hi - lo, 0.1)
            Path { p in
                for (i, v) in points.enumerated() {
                    let x = geo.size.width * CGFloat(i) / CGFloat(max(points.count - 1, 1))
                    let y = geo.size.height * (1 - CGFloat((v - lo) / span))
                    if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(ringWeigh, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        }
    }
}

private struct OpenForge: View {
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "arrow.clockwise").font(.title3).foregroundStyle(ringWeigh)
            Text("Open Forge to update").font(.caption.weight(.semibold)).multilineTextAlignment(.center).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: widgets

private func link(_ route: String) -> URL { URL(string: "forge://open/\(route)")! }

struct ForgeSmallView: View {
    let entry: ForgeWidgetEntry
    var body: some View {
        Group {
            if let s = entry.fresh {
                VStack(spacing: 6) { RingsRow(s: s); KcalLine(kcal: s.kcal) }
            } else { OpenForge() }
        }
        .widgetURL(link("today"))
    }
}

struct ForgeMediumView: View {
    let entry: ForgeWidgetEntry
    var body: some View {
        Group {
            if let s = entry.fresh {
                HStack(spacing: 14) {
                    VStack(spacing: 6) { RingsRow(s: s); KcalLine(kcal: s.kcal) }
                    if let t = s.trend {
                        Link(destination: link("body")) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Weight trend").font(.caption2).foregroundStyle(.secondary)
                                Text("\(t.latest.formatted(.number.precision(.fractionLength(1)))) \(t.unit)").font(.system(.title3, design: .rounded).weight(.bold)).minimumScaleFactor(0.6).lineLimit(1)
                                Sparkline(points: t.points).frame(minHeight: 30)
                            }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Weight trend \(t.latest.formatted(.number.precision(.fractionLength(1)))) \(t.unit)")
                    }
                }
            } else { OpenForge() }
        }
        .widgetURL(link("today"))
    }
}

struct ForgeCircularView: View {
    let entry: ForgeWidgetEntry
    var body: some View {
        Group {
            if let s = entry.fresh, let st = s.steps {
                ZStack {
                    RingArc(fraction: st.fraction, color: .primary, line: 5)
                    VStack(spacing: 0) {
                        Image(systemName: "figure.walk").font(.caption2)
                        Text(st.v.map { $0 >= 10000 ? "\($0 / 1000)k" : number($0) } ?? "–").font(.system(.caption2, design: .rounded).weight(.bold)).minimumScaleFactor(0.5).lineLimit(1).privacySensitive()
                    }
                    .padding(6)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Steps \(st.v ?? 0) of \(st.goal)")
            } else {
                Image(systemName: "arrow.clockwise")
            }
        }
        .widgetURL(link("today"))
    }
}

struct ForgeRectangularView: View {
    let entry: ForgeWidgetEntry
    var body: some View {
        Group {
            if let s = entry.fresh {
                VStack(alignment: .leading, spacing: 2) {
                    if let k = s.kcal { Text("\(number(k.left)) calories left").font(.headline).minimumScaleFactor(0.7).lineLimit(1).privacySensitive() }
                    if let p = s.protein { Text("\(p.left) g protein left").font(.subheadline).minimumScaleFactor(0.7).lineLimit(1).privacySensitive() }
                    if s.kcal == nil && s.protein == nil { Text("Forge").font(.headline) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("Open Forge to update").font(.headline).minimumScaleFactor(0.7)
            }
        }
        .widgetURL(link("food"))
    }
}

struct ForgeTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeTodayWidget", provider: ForgeWidgetProvider()) { entry in
            ForgeWidgetRoot(entry: entry)
                .containerBackground(for: .widget) { widgetBackground }
        }
        .configurationDisplayName("Forge Today")
        .description("Your weigh-in, steps and protein for today.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

struct ForgeWidgetRoot: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeWidgetEntry
    var body: some View {
        switch family {
        case .systemSmall: ForgeSmallView(entry: entry)
        case .accessoryCircular: ForgeCircularView(entry: entry)
        case .accessoryRectangular: ForgeRectangularView(entry: entry)
        default: ForgeMediumView(entry: entry)
        }
    }
}

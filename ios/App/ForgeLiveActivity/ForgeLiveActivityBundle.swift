import WidgetKit
import SwiftUI
import ActivityKit
import AppIntents

// The lock-screen card and Dynamic Island for a live Forge workout. This folder is the ForgeLiveActivity extension
// target, already in the project; App/ForgeLiveShared.swift is in both targets. Navy and cyan, like the app.

private let cyan = Color(red: 0.243, green: 0.784, blue: 0.941)
private let navy = Color(red: 0.016, green: 0.043, blue: 0.055)
private let slate = Color(red: 0.604, green: 0.631, blue: 0.671)

@main
struct ForgeLiveActivityBundle: WidgetBundle {
    var body: some Widget { ForgeLiveActivityWidget() }
}

@available(iOS 17.0, *)
struct PauseButton: View {
    let paused: Bool
    var body: some View {
        Button(intent: ForgeTogglePauseIntent()) {
            Image(systemName: paused ? "play.fill" : "pause.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(navy)
                .frame(width: 48, height: 48)
                .background(cyan, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(paused ? "Resume workout" : "Pause workout")
    }
}

@available(iOS 17.0, *)
struct ClockText: View {
    let state: ForgeLiveAttributes.ContentState
    var body: some View {
        if state.paused {
            Text(Duration.seconds(state.elapsed).formatted(.time(pattern: state.elapsed >= 3600 ? .hourMinuteSecond : .minuteSecond)))
                .foregroundStyle(slate)
        } else {
            Text(state.timerStart, style: .timer).foregroundStyle(cyan)
        }
    }
}

@available(iOS 17.0, *)
struct Stat: View {
    let value: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 22, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(slate)
        }
    }
}

@available(iOS 17.0, *)
private func distance(_ s: ForgeLiveAttributes.ContentState, _ a: ForgeLiveAttributes) -> String {
    let v = a.useMiles ? s.distanceMeters / 1609.344 : s.distanceMeters / 1000
    return String(format: "%.2f", v)
}

@available(iOS 17.0, *)
struct ForgeLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ForgeLiveAttributes.self) { context in
            let s = context.state
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(context.attributes.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(slate)
                    ClockText(state: s).font(.system(size: 40, weight: .heavy, design: .rounded)).monospacedDigit()
                    HStack(spacing: 18) {
                        if context.attributes.showsDistance {
                            Stat(value: distance(s, context.attributes), label: context.attributes.useMiles ? "MI" : "KM")
                            Stat(value: s.avgPace, label: "PACE")
                        }
                        Stat(value: "\(s.activeKcal)", label: "ACTIVE CAL")
                        Stat(value: "\(s.totalKcal)", label: "TOTAL CAL")
                    }
                }
                Spacer(minLength: 0)
                PauseButton(paused: s.paused)
            }
            .padding(16)
            .activityBackgroundTint(navy)
            .activitySystemActionForegroundColor(cyan)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ClockText(state: s).font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.trailing) { PauseButton(paused: s.paused) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 18) {
                        if context.attributes.showsDistance { Stat(value: distance(s, context.attributes), label: context.attributes.useMiles ? "MI" : "KM") }
                        Stat(value: "\(s.activeKcal)", label: "ACTIVE CAL")
                        Stat(value: "\(s.totalKcal)", label: "TOTAL CAL")
                    }
                }
            } compactLeading: {
                Image(systemName: "figure.run").foregroundStyle(cyan)
            } compactTrailing: {
                ClockText(state: s).monospacedDigit().frame(maxWidth: 52)
            } minimal: {
                Image(systemName: s.paused ? "pause.fill" : "figure.run").foregroundStyle(cyan)
            }
            .keylineTint(cyan)
        }
    }
}

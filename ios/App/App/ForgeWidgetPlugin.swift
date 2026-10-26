import Foundation
import Capacitor
import WidgetKit

// Hands the widget its numbers and opens the screen a widget tap asked for. JS side: js/native/widget.js.
// Registered in ForgeBridgeViewController. Never throws into JS: a failed save just leaves the widget on its last numbers.

@objc(ForgeWidgetPlugin)
public class ForgeWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ForgeWidgetPlugin"
    public let jsName = "ForgeWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeRoute", returnType: CAPPluginReturnPromise),
    ]

    /// A route from a widget tap (forge://open/food → "food"), waiting for the web view to pick it up.
    static var pendingRoute: String?
    static weak var current: ForgeWidgetPlugin?

    public override func load() { ForgeWidgetPlugin.current = self }

    /// Called by the scene delegate for forge://open/<route>. Only short lowercase routes are accepted.
    static func open(url: URL) {
        guard url.scheme == "forge", url.host == "open" else { return }
        let route = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard route.range(of: "^[a-z]+(/[A-Za-z0-9_-]+)?$", options: .regularExpression) != nil else { return }
        if let p = current, p.hasListeners("route") {
            pendingRoute = nil
            p.notifyListeners("route", data: ["route": route])
        } else {
            pendingRoute = route // cold launch: nobody is listening yet, JS takes it with takeRoute
        }
    }

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8),
              (try? JSONDecoder().decode(ForgeWidgetSnapshot.self, from: data)) != nil else { call.reject("Not a widget snapshot."); return }
        let ok = ForgeWidgetStore.save(data)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve(["saved": ok])
    }

    @objc func clear(_ call: CAPPluginCall) {
        ForgeWidgetStore.clear()
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve()
    }

    @objc func takeRoute(_ call: CAPPluginCall) {
        let r = ForgeWidgetPlugin.pendingRoute
        ForgeWidgetPlugin.pendingRoute = nil
        call.resolve(r.map { ["route": $0] } ?? [:])
    }
}

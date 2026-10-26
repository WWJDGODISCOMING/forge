import Foundation
import Security

// Shared by the app and the widget extension (ios/App/ForgeLiveActivity): the project builds this file into both.
// The app stores a small snapshot of numbers (no names, photos or food names); the widget reads it. A free Apple ID
// can't use App Groups, so the hand-off goes through a shared Keychain group instead (Keychain Sharing works with
// free signing). Both Info.plists carry ForgeKeychainGroup = $(AppIdentifierPrefix)com.christianeverett.forge.shared.

public struct ForgeWidgetProgress: Codable, Hashable {
    public var v: Int?
    public var goal: Int
    public var fraction: Double { guard let v = v, goal > 0 else { return 0 } return min(1, Double(v) / Double(goal)) }
    public var left: Int { max(0, goal - (v ?? 0)) }
}

public struct ForgeWidgetTrend: Codable, Hashable {
    public var unit: String
    public var latest: Double
    public var points: [Double]
}

public struct ForgeWidgetSnapshot: Codable, Hashable {
    public var v: Int
    public var at: Double          // milliseconds since 1970
    public var day: String         // local yyyy-MM-dd the numbers describe
    public var weigh: Bool
    public var steps: ForgeWidgetProgress?
    public var protein: ForgeWidgetProgress?
    public var kcal: ForgeWidgetProgress?
    public var trend: ForgeWidgetTrend?

    public static let version = 1
    public static let staleAfter: TimeInterval = 24 * 3600

    /// Numbers from another day, an older format or more than a day ago are never shown.
    public func isStale(at now: Date, today: String) -> Bool {
        v != ForgeWidgetSnapshot.version || day != today || now.timeIntervalSince1970 - at / 1000 > ForgeWidgetSnapshot.staleAfter
    }
}

public enum ForgeWidgetStore {
    private static let service = "com.christianeverett.forge.widget"
    private static let account = "snapshot"

    private static var group: String? {
        Bundle.main.object(forInfoDictionaryKey: "ForgeKeychainGroup") as? String
    }

    private static func query() -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let g = group, !g.isEmpty, !g.contains("$(") { q[kSecAttrAccessGroup as String] = g }
        return q
    }

    @discardableResult
    public static func save(_ data: Data) -> Bool {
        SecItemDelete(query() as CFDictionary)
        var q = query()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock // readable while the phone is locked (lock-screen widgets)
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    public static func clear() { SecItemDelete(query() as CFDictionary) }

    public static func load() -> ForgeWidgetSnapshot? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(ForgeWidgetSnapshot.self, from: data)
    }
}

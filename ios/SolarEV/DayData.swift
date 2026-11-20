import Foundation

/// GET /api/mobile/day?span=day|week|month|year&day=YYYY-MM-DD (src/mobilePeriod.js on the server).
/// Buckets: 5 min for a day, 1 h for a week or month, 1 day for a year; each value is the bucket's average.
/// Power is in watts: grid is + for import, battery + for discharge, the same signs as the web History tab.
/// A null is a bucket with no data. ev only counts readings with a real Bluetooth link.
struct DayData: Codable, Equatable, Sendable {
    struct Energy: Codable, Equatable, Sendable {
        var produced: Double
        var consumed: Double
        var imported: Double
        var exported: Double
        var charged: Double
        var discharged: Double
        var ev: Double
        var socMin: Double?
        var socMax: Double?
        var coverage: Double?
    }

    var span: String?
    var day: String // first day of the period
    var from: Double
    var to: Double
    var res: Double
    var until: Double
    var t: [Double]
    var pv: [Double?]
    var load: [Double?]
    var grid: [Double?]
    var batt: [Double?]
    var soc: [Double?]
    var ev: [Double?]
    var energy: Energy
}

/// The server's day key: local date as YYYY-MM-DD.
enum DayKey {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func of(_ date: Date) -> String { formatter.string(from: date) }
}

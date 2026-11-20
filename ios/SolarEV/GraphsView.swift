import Charts
import SwiftUI

/// Graphs like the web History tab: power, home battery charge and energy totals for a day, week, month or year.
/// Swipe left or right to change period. Tap the power chart for a landscape view with pinch to zoom and drag to pan.
/// A period that includes now refreshes every minute.
struct GraphsView: View {
    let store: Store

    @State private var span: Span = .day
    @State private var start = Span.day.start(of: .now)
    @State private var chart: DayChart?
    @State private var failed = false
    @State private var showDetail = false

    private var isCurrent: Bool { start >= span.start(of: .now) }
    private var requestKey: String { "\(span.rawValue) \(DayKey.of(start))" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Period", selection: $span) {
                    ForEach(Span.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                PeriodPicker(label: span.label(start), isCurrent: isCurrent, step: step)
                if let chart, chart.matches(span: span, start: start) {
                    PowerCard(chart: chart, span: span) { showDetail = true }
                    SocCard(chart: chart, span: span)
                    EnergyCard(energy: chart.data.energy, span: span)
                } else if failed {
                    BadgeView(badge: Badge(tone: .bad, text: "Can't load this period. Pull down to try again."))
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 240)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
            .contentShape(Rectangle())
            // Swipe sideways to change period; vertical drags still scroll.
            .simultaneousGesture(
                DragGesture(minimumDistance: 30).onEnded { drag in
                    let dx = drag.translation.width, dy = drag.translation.height
                    guard abs(dx) > 60, abs(dx) > abs(dy) * 1.5 else { return }
                    step(dx < 0 ? 1 : -1)
                }
            )
        }
        .refreshable { await load() }
        .navigationTitle("Graphs")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: span) { _, new in start = new.start(of: start) }
        .task(id: requestKey) {
            failed = false
            while !Task.isCancelled {
                await load()
                guard isCurrent else { break }
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .fullScreenCover(isPresented: $showDetail) {
            if let chart {
                PowerDetailView(chart: chart, span: span, label: span.label(start))
            }
        }
    }

    private func step(_ k: Int) {
        guard k < 0 || !isCurrent else { return } // no future periods
        withAnimation(.easeInOut(duration: 0.2)) { start = span.shift(start, by: k) }
    }

    private func load() async {
        let key = requestKey
        if let data = await store.loadPeriod(span: span.rawValue, day: DayKey.of(start)) {
            guard key == requestKey else { return } // the period changed while this was loading
            chart = DayChart(data)
            failed = false
        } else if !(chart?.matches(span: span, start: start) ?? false) {
            failed = true
        }
    }
}

// MARK: - Periods

/// Same periods as the web History tab and the server (src/mobilePeriod.js): weeks start on Monday.
enum Span: String, CaseIterable, Identifiable {
    case day, week, month, year

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    private static let calendar: Calendar = {
        var c = Calendar.current
        c.firstWeekday = 2 // Monday
        return c
    }()

    func start(of date: Date) -> Date {
        let c = Self.calendar
        switch self {
        case .day: return c.startOfDay(for: date)
        case .week: return c.dateInterval(of: .weekOfYear, for: date)?.start ?? c.startOfDay(for: date)
        case .month: return c.dateInterval(of: .month, for: date)?.start ?? c.startOfDay(for: date)
        case .year: return c.dateInterval(of: .year, for: date)?.start ?? c.startOfDay(for: date)
        }
    }

    func shift(_ start: Date, by k: Int) -> Date {
        let component: Calendar.Component = switch self {
        case .day: .day
        case .week: .weekOfYear
        case .month: .month
        case .year: .year
        }
        return self.start(of: Self.calendar.date(byAdding: component, value: k, to: start) ?? start)
    }

    func label(_ start: Date) -> String {
        let c = Self.calendar
        switch self {
        case .day:
            if c.isDateInToday(start) { return "Today" }
            if c.isDateInYesterday(start) { return "Yesterday" }
            return start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        case .week:
            if start == Span.week.start(of: .now) { return "This week" }
            let last = c.date(byAdding: .day, value: 6, to: start) ?? start
            return "\(start.formatted(.dateTime.month(.abbreviated).day())) – \(last.formatted(.dateTime.month(.abbreviated).day()))"
        case .month:
            return start.formatted(.dateTime.month(.wide).year())
        case .year:
            return start.formatted(.dateTime.year())
        }
    }

    /// What one bucket means, for the footnotes.
    var bucketNote: String {
        switch self {
        case .day: "5-minute averages"
        case .week, .month: "hourly averages"
        case .year: "daily averages"
        }
    }

    /// Smallest window the detail view zooms in to.
    var minVisible: TimeInterval {
        switch self {
        case .day: 30 * 60
        case .week: 3 * 3600
        case .month: 12 * 3600
        case .year: 14 * 86400
        }
    }

    @AxisContentBuilder
    var xAxis: some AxisContent {
        switch self {
        case .day:
            AxisMarks(values: .stride(by: .hour, count: 3)) {
                AxisGridLine()
                AxisValueLabel(format: .dateTime.hour())
            }
        case .week:
            AxisMarks(values: .stride(by: .day)) {
                AxisGridLine()
                AxisValueLabel(format: .dateTime.weekday(.narrow), centered: true)
            }
        case .month:
            AxisMarks(values: .stride(by: .day, count: 7)) {
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month(.abbreviated).day())
            }
        case .year:
            AxisMarks(values: .stride(by: .month)) {
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month(.narrow), centered: true)
            }
        }
    }

    func readingTime(_ date: Date) -> String {
        switch self {
        case .day: date.formatted(.dateTime.hour().minute())
        case .week, .month: date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour())
        case .year: date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
    }
}

private struct PeriodPicker: View {
    let label: String
    let isCurrent: Bool
    let step: (Int) -> Void

    var body: some View {
        HStack {
            Button { step(-1) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous")
            Spacer()
            Text(label).font(.headline)
            Spacer()
            Button { step(1) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next")
                .disabled(isCurrent)
        }
        .buttonStyle(.bordered)
    }
}

// MARK: - Chart data

/// The lines on the power chart. Colours are Okabe-Ito hues kept away from the app's blue (good) and
/// vermillion (bad), and each line also has its own stroke, so they can be told apart without colour.
enum PowerSeries: String, CaseIterable, Identifiable {
    case solar = "Solar"
    case home = "Home"
    case grid = "Grid (+import)"
    case battery = "Battery (+discharge)"
    case ev = "EV charging"

    var id: String { rawValue }
    var shortName: String { rawValue.replacingOccurrences(of: #" \(.*"#, with: "", options: .regularExpression) }

    func color(_ scheme: ColorScheme) -> Color {
        switch self {
        case .solar: Color(hex: 0xE69F00)
        case .home: .primary
        case .grid: Color(hex: scheme == .dark ? 0xA3AFBA : 0x6B7785)
        case .battery: Color(hex: 0x009E73)
        case .ev: Color(hex: 0xCC79A7)
        }
    }

    var stroke: StrokeStyle {
        switch self {
        case .solar: StrokeStyle(lineWidth: 2)
        case .home: StrokeStyle(lineWidth: 1.5)
        case .grid: StrokeStyle(lineWidth: 1.5, dash: [6, 3])
        case .battery: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.5, 3.5])
        case .ev: StrokeStyle(lineWidth: 2.5)
        }
    }

    func values(_ d: DayData) -> [Double?] {
        switch self {
        case .solar: d.pv
        case .home: d.load
        case .grid: d.grid
        case .battery: d.batt
        case .ev: d.ev
        }
    }
}

struct ChartPoint: Identifiable {
    let id: Int
    let date: Date
    let value: Double
    let segment: Int // a gap in the data starts a new segment, so the line breaks there instead of bridging it
}

struct PowerLine: Identifiable {
    let series: PowerSeries
    let points: [ChartPoint]
    var id: String { series.id }
}

struct Reading {
    let date: Date
    let values: [(PowerSeries, Double?)]
    let soc: Double?
}

/// Built once per reply, so dragging across the chart doesn't redo it.
struct DayChart {
    let data: DayData
    let start: Date
    let end: Date
    let power: [PowerLine]
    let soc: [ChartPoint]

    init(_ data: DayData) {
        self.data = data
        start = Date(timeIntervalSince1970: data.from)
        end = Date(timeIntervalSince1970: data.to)
        power = PowerSeries.allCases.compactMap { series in
            let points = Self.points(series.values(data), times: data.t, scale: 0.001)
            // No EV line in a period the car never charged with a real link.
            if series == .ev && !points.contains(where: { $0.value > 0 }) { return nil }
            return points.isEmpty ? nil : PowerLine(series: series, points: points)
        }
        soc = Self.points(data.soc, times: data.t, scale: 1)
    }

    func matches(span: Span, start: Date) -> Bool {
        (data.span ?? "day") == span.rawValue && data.day == DayKey.of(start)
    }

    private static func points(_ values: [Double?], times: [Double], scale: Double) -> [ChartPoint] {
        var out: [ChartPoint] = []
        var segment = 0
        var gap = true
        for (i, value) in values.enumerated() where i < times.count {
            guard let value else { gap = true; continue }
            if gap { segment += 1; gap = false }
            out.append(ChartPoint(id: i, date: Date(timeIntervalSince1970: times[i]), value: value * scale, segment: segment))
        }
        return out
    }

    /// The bucket under a touched time, with each line's value there (kW).
    func reading(at date: Date?) -> Reading? {
        guard let date, !data.t.isEmpty else { return nil }
        let target = date.timeIntervalSince1970
        // Buckets aren't evenly spaced across DST or gaps, so find the last one at or before the touch.
        let i = max(0, (data.t.lastIndex(where: { $0 <= target }) ?? 0))
        let values = power.map { line in (line.series, line.series.values(data)[safe: i].flatMap { $0 }.map { $0 / 1000 }) }
        return Reading(date: Date(timeIntervalSince1970: data.t[i]), values: values, soc: data.soc[safe: i].flatMap { $0 })
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

// MARK: - Shared chart pieces

/// The power lines, used by both the card and the full-screen view.
private struct PowerMarks: ChartContent {
    let chart: DayChart
    let scheme: ColorScheme

    var body: some ChartContent {
        RuleMark(y: .value("Zero", 0))
            .foregroundStyle(Color.secondary.opacity(0.5))
            .lineStyle(StrokeStyle(lineWidth: 0.5))
        ForEach(chart.power) { line in
            ForEach(line.points) { p in
                LineMark(
                    x: .value("Time", p.date),
                    y: .value("kW", p.value),
                    series: .value("Line", "\(line.series.id) \(p.segment)")
                )
                .foregroundStyle(line.series.color(scheme))
                .lineStyle(line.series.stroke)
                .interpolationMethod(line.series == .ev ? .stepEnd : .linear)
            }
        }
    }
}

@AxisContentBuilder
private func kwAxis() -> some AxisContent {
    AxisMarks(position: .leading) { value in
        AxisGridLine()
        AxisValueLabel {
            if let kw = value.as(Double.self) { Text("\(kw, format: .number.precision(.fractionLength(0...1))) kW") }
        }
    }
}

private struct ReadingBox: View {
    let reading: Reading
    let span: Span

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(span.readingTime(reading.date)).font(.caption.weight(.semibold))
            ForEach(reading.values, id: \.0.id) { series, kw in
                Text("\(series.shortName): \(kw.map { String(format: "%.2f kW", $0) } ?? "–")")
            }
            if let soc = reading.soc { Text("Battery: \(Int(soc))%") }
        }
        .font(.caption)
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct Legend: View {
    let lines: [PowerSeries]
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(lines) { series in
                HStack(spacing: 6) {
                    Canvas { context, size in
                        var path = Path()
                        path.move(to: CGPoint(x: 0, y: size.height / 2))
                        path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                        context.stroke(path, with: .color(series.color(scheme)), style: series.stroke)
                    }
                    .frame(width: 24, height: 8)
                    .accessibilityHidden(true)
                    Text(series.rawValue).font(.caption)
                }
            }
        }
    }
}

// MARK: - Cards

private struct GraphCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct PowerCard: View {
    let chart: DayChart
    let span: Span
    let open: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GraphCard(title: "Power") {
            Chart { PowerMarks(chart: chart, scheme: scheme) }
                .chartXScale(domain: chart.start...chart.end)
                .chartXAxis { span.xAxis }
                .chartYAxis { kwAxis() }
                .frame(height: 240)
                .contentShape(Rectangle())
                .onTapGesture(perform: open)
                .accessibilityAction(named: "Open full screen", open)

            Legend(lines: chart.power.map(\.series))
            Text("Tap the chart for a full-screen view you can zoom. Swipe sideways to change \(span.rawValue). \(span.bucketNote.capitalized). Grid is + when buying, battery + when it powers the house.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct SocCard: View {
    let chart: DayChart
    let span: Span

    var body: some View {
        GraphCard(title: "Home battery charge") {
            if chart.soc.isEmpty {
                Text("No battery readings in this period.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                Chart(chart.soc) { p in
                    LineMark(x: .value("Time", p.date), y: .value("Charge", p.value), series: .value("Line", p.segment))
                        .foregroundStyle(Color(hex: 0x009E73))
                        .lineStyle(StrokeStyle(lineWidth: 2))
                }
                .chartXScale(domain: chart.start...chart.end)
                .chartYScale(domain: 0...100)
                .chartXAxis { span.xAxis }
                .chartYAxis {
                    AxisMarks(position: .leading, values: [0, 50, 100]) { value in
                        AxisGridLine()
                        AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)%") } }
                    }
                }
                .frame(height: 120)
            }
        }
    }
}

private struct EnergyCard: View {
    let energy: DayData.Energy
    let span: Span

    private var tiles: [(String, String)] {
        var out = [
            ("Solar made", kwh(energy.produced)),
            ("Home used", kwh(energy.consumed)),
            ("Bought from grid", kwh(energy.imported)),
            ("Sold to grid", kwh(energy.exported)),
            ("Battery charged", kwh(energy.charged)),
            ("Battery used", kwh(energy.discharged)),
            ("EV charged", kwh(energy.ev)),
        ]
        if let low = energy.socMin, let high = energy.socMax {
            out.append(("Battery range", "\(Int(low))–\(Int(high))%"))
        }
        return out
    }

    var body: some View {
        GraphCard(title: "Energy") {
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 12) {
                ForEach(tiles, id: \.0) { title, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.caption).foregroundStyle(.secondary)
                        Text(value).font(.title3.weight(.semibold)).monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if let coverage = energy.coverage, coverage < 0.95 {
                Text("Readings cover \(Int((coverage * 100).rounded()))% of this \(span.rawValue) so far, so totals may be low.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text("EV charged counts only times the bridge had a real Bluetooth link to the car.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    /// One decimal below 100 kWh, whole kWh above (a year runs to thousands).
    private func kwh(_ wh: Double) -> String {
        let k = wh / 1000
        return k < 100 ? String(format: "%.1f kWh", k) : "\(k.formatted(.number.precision(.fractionLength(0)))) kWh"
    }
}

// MARK: - Full screen

/// Landscape power chart: pinch to zoom, drag to pan, touch and hold to read values.
private struct PowerDetailView: View {
    let chart: DayChart
    let span: Span
    let label: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var visible: TimeInterval = 0
    @State private var leading: Date = .now
    @State private var pinchFrom: (visible: TimeInterval, center: Date)?
    @State private var selected: Date?

    private var full: TimeInterval { chart.end.timeIntervalSince(chart.start) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Power · \(label)").font(.headline)
                Spacer()
                if visible < full {
                    Button("Show all") { withAnimation { visible = full; leading = chart.start } }
                        .buttonStyle(.bordered)
                }
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
            Chart {
                PowerMarks(chart: chart, scheme: scheme)
                if let reading = chart.reading(at: selected) {
                    RuleMark(x: .value("Selected", reading.date))
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1))
                        .annotation(position: .trailing, alignment: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            ReadingBox(reading: reading, span: span)
                        }
                }
            }
            .chartXScale(domain: chart.start...chart.end)
            .chartYAxis { kwAxis() }
            .chartScrollableAxes(.horizontal)
            .chartXVisibleDomain(length: max(visible, span.minVisible))
            .chartScrollPosition(x: $leading)
            .chartXSelection(value: $selected)
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { pinch in
                        let from = pinchFrom ?? (visible, leading.addingTimeInterval(visible / 2))
                        pinchFrom = from
                        let length = min(full, max(span.minVisible, from.visible / pinch.magnification))
                        visible = length
                        // Keep the point under the pinch centre where it was, within the period.
                        let start = from.center.addingTimeInterval(-length / 2)
                        leading = min(max(start, chart.start), chart.end.addingTimeInterval(-length))
                    }
                    .onEnded { _ in pinchFrom = nil }
            )
            Legend(lines: chart.power.map(\.series))
            Text("Pinch to zoom, drag to pan, touch and hold to read values. \(span.bucketNote.capitalized).")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .onAppear {
            visible = full
            leading = chart.start
            OrientationLock.set(.landscape)
        }
        .onDisappear { OrientationLock.set(.portrait) }
    }
}

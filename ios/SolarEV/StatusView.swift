import SwiftUI

struct StatusView: View {
    let store: Store
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    StatusContent(model: StatusModel(
                        snapshot: store.snapshot,
                        fetchedAt: store.fetchedAt,
                        route: store.route,
                        problem: store.problem,
                        now: context.date
                    ))
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .refreshable { await store.refresh() }
            .navigationTitle("Solar EV")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                }
            }
            .sheet(isPresented: $showSettings) {
                NavigationStack {
                    SettingsView(store: store, isFirstRun: false)
                }
            }
        }
    }
}

/// The screen's contents, with no scrolling or navigation around them.
struct StatusContent: View {
    let model: StatusModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BadgeView(badge: model.header)
            if let home = model.home {
                HomeCardView(card: home)
            }
            ForEach(model.cars) { CarCardView(card: $0) }
            if let bridge = model.bridge {
                BadgeView(badge: bridge)
            }
        }
    }
}

private struct HomeCardView: View {
    let card: StatusModel.HomeCard

    var body: some View {
        CardShell {
            Text("Home battery").font(.headline)
            SocNumber(value: card.soc, dim: card.dim, note: card.dim ? "Last reading" : "Live")
            SocBar(value: card.soc, limit: nil, dim: card.dim)
            if let activity = card.activity {
                Text(activity).font(.subheadline)
            }
            BadgeView(badge: card.badge)
            if let detail = card.detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct CarCardView: View {
    let card: StatusModel.CarCard

    var body: some View {
        CardShell {
            Text(card.name).font(.headline)
            SocNumber(value: card.soc, dim: card.dim, note: card.limit.map { "limit \(Format.whole($0))%" })
            SocBar(value: card.soc, limit: card.limit, dim: card.dim)
            Text(card.socNote).font(.footnote).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                if card.isCharging {
                    Image(systemName: "bolt.fill").accessibilityHidden(true)
                }
                Text(card.activity).font(.subheadline.weight(card.isCharging ? .semibold : .regular))
            }
            BadgeView(badge: card.badge)
            if let detail = card.detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct CardShell<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }
}

private struct SocNumber: View {
    let value: Double?
    let dim: Bool
    let note: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value.map(Format.whole) ?? "–")
                    .font(.system(size: 50, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text("%").font(.title2.weight(.medium))
            }
            .foregroundStyle(dim ? .secondary : .primary)
            if let note {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// Neutral on purpose: a charge level is not good or bad in itself.
private struct SocBar: View {
    let value: Double?
    let limit: Double?
    let dim: Bool

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.1))
                if let value {
                    Capsule()
                        .fill(Color.primary.opacity(dim ? 0.3 : 0.75))
                        .frame(width: max(8, width * min(value, 100) / 100))
                }
                if let limit {
                    Rectangle()
                        .fill(Color.primary)
                        .frame(width: 2)
                        .offset(x: width * min(limit, 100) / 100 - 1)
                }
            }
        }
        .frame(height: 8)
        .accessibilityHidden(true)
    }
}

struct BadgeView: View {
    let badge: Badge
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let palette = Palette(scheme: scheme)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(badge.symbol).fontWeight(.bold).accessibilityHidden(badge.tone == .neutral)
            Text(badge.text)
        }
        .font(.subheadline)
        .foregroundStyle(palette.foreground(badge.tone))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(palette.background(badge.tone), in: RoundedRectangle(cornerRadius: 8))
    }
}

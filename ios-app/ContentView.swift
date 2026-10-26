import Network
import SwiftUI
import WebKit

private let defaultRadarURL = URL(string: "http://45.93.249.214:63816/")!

struct ContentView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack {
            RadarWebView(url: model.url, model: model, isLoading: $model.isLoading, error: $model.error)
                .ignoresSafeArea(edges: .bottom)

            if model.isLoading {
                LoadingView()
            } else if let error = model.error {
                OfflineView(message: error, retry: model.retry)
            }
        }
        .background(Color(red: 0.035, green: 0.06, blue: 0.075))
        .task { model.start() }
    }
}

@MainActor
final class WebViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var error: String?
    let url: URL
    private var monitor: NWPathMonitor?
    private var webView: WKWebView?

    init() {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "RadarURL") as? String,
           let parsed = URL(string: configured), parsed.scheme == "http" || parsed.scheme == "https" {
            url = parsed
        } else {
            url = defaultRadarURL
        }
    }

    func start() {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                if path.status == .satisfied { self?.error = nil }
                else if self?.webView == nil { self?.error = "Keine Internetverbindung. Die Live-Daten sind momentan nicht erreichbar." }
            }
        }
        monitor.start(queue: DispatchQueue(label: "opsucht.network-monitor"))
    }

    func attach(_ webView: WKWebView) { self.webView = webView }
    func retry() {
        error = nil
        isLoading = true
        webView?.load(URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15))
    }
}

struct RadarWebView: UIViewRepresentable {
    let url: URL
    @ObservedObject var model: WebViewModel
    @Binding var isLoading: Bool
    @Binding var error: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        model.attach(view)
        view.load(URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15))
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: RadarWebView
        init(_ parent: RadarWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation _: WKNavigation?) {
            DispatchQueue.main.async { self.parent.isLoading = true; self.parent.error = nil }
        }
        func webView(_ webView: WKWebView, didFinish _: WKNavigation?) {
            DispatchQueue.main.async { self.parent.isLoading = false; self.parent.error = nil }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation?, withError error: Error) {
            DispatchQueue.main.async { self.parent.isLoading = false; self.parent.error = "OPSUCHT Market konnte nicht geladen werden. Prüfe die Verbindung und versuche es erneut." }
        }
    }
}

private struct LoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 42, weight: .semibold)).foregroundStyle(.mint)
            Text("OPSUCHT Market").font(.title2.bold()).foregroundStyle(.white)
            ProgressView().tint(.mint)
            Text("Marktdaten werden geladen …").foregroundStyle(.gray)
        }.padding(32).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22))
    }
}

private struct OfflineView: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 38)).foregroundStyle(.orange)
            Text("Keine Verbindung").font(.title2.bold()).foregroundStyle(.white)
            Text(message).multilineTextAlignment(.center).foregroundStyle(.gray)
            Button("Erneut versuchen", action: retry).buttonStyle(.borderedProminent).tint(.mint)
        }.padding(28).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22)).padding(24)
    }
}

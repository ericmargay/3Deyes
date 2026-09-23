import SwiftUI
import WebKit

/// URL del sitio publicado. `vr=1` arranca sin interfaz y con un solo toque para iniciar.
enum Site {
    static let url = URL(string: "https://ericmargay.github.io/3Deyes/?vr=1")!
}

final class WebBridge: ObservableObject {
    weak var webView: WKWebView?

    /// Ejecuta JavaScript en la página (window.app es la aplicación 3Deyes).
    func run(_ js: String) {
        webView?.evaluateJavaScript(js) { _, error in
            if let error { print("js:", error.localizedDescription) }
        }
    }

    func reload() { webView?.load(URLRequest(url: Site.url)) }
}

struct WebView: UIViewRepresentable {
    let bridge: WebBridge

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.bounces = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.allowsBackForwardNavigationGestures = false
        wv.navigationDelegate = context.coordinator
        wv.load(URLRequest(url: Site.url))
        bridge.webView = wv
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("carga:", error.localizedDescription)
        }
    }
}

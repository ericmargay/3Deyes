import SwiftUI
import UIKit

/// 3Deyes · visor: abre el sitio publicado en modo visor VR a pantalla completa
/// (sin barras de Safari). Los controles nativos hablan con la página por JavaScript.
@main
struct DeyesVRApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    @StateObject private var bridge = WebBridge()
    @State private var showControls = true
    @State private var zoom: Double = 0.9
    @State private var fov: Double = 90
    @State private var scene = "track"

    private let scenes: [(String, String)] = [("room", "Habitación"), ("fluid", "Fluido"), ("blob", "Metaballs"), ("track", "Track")]

    var body: some View {
        ZStack(alignment: .top) {
            WebView(bridge: bridge).ignoresSafeArea()
            if showControls {
                controls
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else {
                HStack {
                    Spacer()
                    Button { withAnimation { showControls = true } } label: {
                        Image(systemName: "slider.horizontal.3").padding(10)
                    }
                    .background(.ultraThinMaterial, in: Circle())
                    .padding(12)
                }
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onChange(of: zoom) { _, v in bridge.run("app.setZoom(\(v))") }
        .onChange(of: fov) { _, v in bridge.run("app.params.set('stereo.vrFov', \(v))") }
        .onChange(of: scene) { _, s in bridge.run("app.setScene('\(s)')") }
    }

    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Picker("Escena", selection: $scene) {
                    ForEach(scenes, id: \.0) { Text($0.1).tag($0.0) }
                }
                .pickerStyle(.segmented)
                Button("Recentrar") { bridge.run("app.gyro.recenter()") }
                    .buttonStyle(.bordered)
                Button("Recargar") { bridge.reload() }
                    .buttonStyle(.bordered)
                Button { withAnimation { showControls = false } } label: { Image(systemName: "eye.slash") }
                    .buttonStyle(.bordered)
            }
            HStack(spacing: 12) {
                Text("Zoom").font(.caption).frame(width: 44, alignment: .leading)
                Slider(value: $zoom, in: 0.4...1.0)
                Text(String(format: "%.2f", zoom)).font(.caption.monospacedDigit()).frame(width: 40)
                Text("FOV").font(.caption).frame(width: 34, alignment: .leading)
                Slider(value: $fov, in: 60...110)
                Text(String(format: "%.0f°", fov)).font(.caption.monospacedDigit()).frame(width: 40)
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 60)
    }
}

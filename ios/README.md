# 3Deyes · visor (app iOS)

App mínima que abre el sitio publicado a pantalla completa, sin las barras de
Safari, para usar el teléfono dentro de un visor VR. Carga
`https://ericmargay.github.io/3Deyes/?vr=1` en un WKWebView: la página arranca
sin interfaz y pide un solo toque para iniciar (habilita giroscopio y audio).

Controles nativos (se ocultan con el ojo tachado): escena, **zoom** (tamaño de
imagen, idéntico para los dos lentes), FOV, recentrar la mirada, recargar.
En la página también funciona el pellizco de dos dedos para el zoom.

## Instalar con cuenta gratuita de Apple

1. Abrir `ios/3DeyesVR.xcodeproj` en Xcode (15 o superior).
2. Xcode → Settings → Accounts → agregar el Apple ID (no hace falta pagar).
3. En el target **3DeyesVR** → Signing & Capabilities: marcar *Automatically
   manage signing*, elegir el Team personal y cambiar el *Bundle Identifier*
   por uno propio (por ejemplo `com.tunombre.3deyes.visor`).
4. Conectar el iPhone por cable, elegirlo como destino y ▶ Run.
5. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confiar
   en el perfil del desarrollador.

Con cuenta gratuita la firma vence a los 7 días: volver a ejecutar desde Xcode
la renueva. Máximo 3 apps firmadas así a la vez.

## Cambiar la URL

`ios/3DeyesVR/WebView.swift`, constante `Site.url`. Para probar contra el
servidor local: `http://<ip-de-la-mac>:5173/?vr=1` y agregar en `Info.plist`
`NSAppTransportSecurity` → `NSAllowsArbitraryLoads` = YES.

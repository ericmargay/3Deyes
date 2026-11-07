/*
 * 3Deyes – ESP32 + LEDs direccionables como artefacto Art-Net (tubo / barra).
 *
 * Recibe un universo Art-Net por WiFi (UDP 6454) y lo vuelca a una tira
 * WS2812B / SK6812 / APA102 con FastLED. Un tubo de 60 px usa 180 canales.
 * Si no llega nada durante 3 s (sin red, batería sola) respira en el último
 * color, así el artefacto nunca queda muerto en el set.
 *
 * Librerías (Arduino IDE → Library Manager): FastLED.
 * Placa: ESP32 Dev Module (o C3 / S3). Pin de datos por un resistor de 330 Ω;
 * capacitor de 1000 µF en la alimentación de la tira; nivel 5 V con un
 * level shifter (74AHCT125) si la tira lo pide. Con batería (18650 + boost
 * 5 V) limitar BRILLO_MAX: 60 px a blanco pleno piden ~3.6 A.
 *
 * En la app el rig tiene cada tubo con su ip y universo (src/stage/rig.js):
 * poner acá los mismos. Con DHCP, cambiar en rig.js la ip que asignó el router
 * o usar la dirección de difusión de la red.
 */
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>

const char* SSID = "3deyes";          // red del set (un router propio, sin internet, es lo más estable)
const char* PASS = "cinestesia";
const int   UNIVERSO = 0;             // el de este artefacto en rig.js
const int   NUM_LEDS = 60;
const int   DATA_PIN = 13;
const int   BRILLO_MAX = 200;         // 255 = pleno; bajar con batería
const bool  IP_FIJA = true;
IPAddress ip(2, 0, 0, 10), gateway(2, 0, 0, 1), subnet(255, 0, 0, 0);   // Art-Net clásico usa 2.x.x.x

CRGB leds[NUM_LEDS];
WiFiUDP udp;
uint8_t buf[530];
unsigned long lastPacket = 0;

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(BRILLO_MAX);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 3000);
  fill_solid(leds, NUM_LEDS, CRGB(8, 0, 16)); FastLED.show();
  if (IP_FIJA) WiFi.config(ip, gateway, subnet);
  WiFi.mode(WIFI_STA);
  WiFi.begin(SSID, PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\nconectado: %s  universo %d\n", WiFi.localIP().toString().c_str(), UNIVERSO);
  udp.begin(6454);
}

void loop() {
  int n = udp.parsePacket();
  if (n > 0) {
    int len = udp.read(buf, sizeof(buf));
    // cabecera "Art-Net\0", OpDmx 0x5000 (little endian), universo en [14..15], largo en [16..17] (big endian)
    if (len >= 18 && memcmp(buf, "Art-Net", 8) == 0 && buf[8] == 0x00 && buf[9] == 0x50) {
      int uni = buf[14] | (buf[15] << 8);
      int dlen = (buf[16] << 8) | buf[17];
      if (uni == UNIVERSO) {
        int px = min(NUM_LEDS, dlen / 3);
        for (int i = 0; i < px; i++) leds[i] = CRGB(buf[18 + i * 3], buf[19 + i * 3], buf[20 + i * 3]);
        FastLED.show();
        lastPacket = millis();
      }
    }
  }
  // sin datos: respiración lenta con el último color (artefacto a batería, sin red)
  if (millis() - lastPacket > 3000) {
    static uint8_t phase = 0; phase += 1;
    uint8_t b = 40 + (sin8(phase) >> 2);
    FastLED.setBrightness(b);
    FastLED.show();
    delay(20);
  } else if (FastLED.getBrightness() != BRILLO_MAX) FastLED.setBrightness(BRILLO_MAX);
}

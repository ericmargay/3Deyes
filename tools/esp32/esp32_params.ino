/*
 * 3Deyes – ESP32: manda potenciómetros / sensores por USB serial.
 *
 * Protocolo (una línea por lectura, 115200 baudios):
 *   k0 0.532        → fuente "serial:k0", valor normalizado 0..1
 *   b0 1            → botón (0/1), útil para parámetros booleanos o triggers
 *
 * En el navegador: GUI → conexiones → "serial" → elegir el puerto del ESP32.
 * Luego doble clic en un parámetro y mover el potenciómetro para asignarlo.
 */
const int KNOB_PINS[] = {34, 35, 32, 33};      // entradas ADC1 (no usar ADC2 con WiFi)
const int BUTTON_PINS[] = {25, 26};
const int N_KNOBS = sizeof(KNOB_PINS) / sizeof(KNOB_PINS[0]);
const int N_BUTTONS = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);

float smooth[8];
float lastSent[8];
int lastButton[8];

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  for (int i = 0; i < N_BUTTONS; i++) pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  for (int i = 0; i < 8; i++) { smooth[i] = 0; lastSent[i] = -1; lastButton[i] = -1; }
}

void loop() {
  for (int i = 0; i < N_KNOBS; i++) {
    float v = analogRead(KNOB_PINS[i]) / 4095.0f;
    smooth[i] = smooth[i] * 0.85f + v * 0.15f;           // filtro simple contra ruido
    if (fabs(smooth[i] - lastSent[i]) > 0.004f) {        // solo mandar cambios
      Serial.printf("k%d %.4f\n", i, smooth[i]);
      lastSent[i] = smooth[i];
    }
  }
  for (int i = 0; i < N_BUTTONS; i++) {
    int b = digitalRead(BUTTON_PINS[i]) == LOW ? 1 : 0;
    if (b != lastButton[i]) { Serial.printf("b%d %d\n", i, b); lastButton[i] = b; }
  }
  delay(15);   // ~66 Hz
}

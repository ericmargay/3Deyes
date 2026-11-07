/*
 * 3Deyes – ESP32: sensor de presencia para la escena "Diosas".
 *
 * Dos sensores ultrasónicos HC-SR04, uno a cada lado del mural, miden a qué
 * distancia está la persona más cercana. Con eso se calcula:
 *   diosas.mirada.presencia  1 si hay alguien a menos de MAX_CM, si no 0
 *   diosas.mirada.x          dónde está (0 = izquierda … 1 = derecha) → las diosas la siguen con la mirada
 * y dos botones opcionales:
 *   diosas.ritmo.beat        tap tempo / marcar el beat
 *   diosas.mirada.parpadear  todas parpadean
 *
 * Los ids completos van directo al parámetro (valor normalizado 0..1), no
 * hace falta asignar nada con learn. En la escena elegir mirada.modo = "sensor".
 *
 * ATENCIÓN: el pin ECHO del HC-SR04 da 5 V; usar un divisor (1 kΩ / 2 kΩ) o
 * un módulo de 3.3 V (RCWL-1601) antes de entrar al ESP32.
 */
const int TRIG_L = 5, ECHO_L = 18;
const int TRIG_R = 19, ECHO_R = 21;
const int BTN_BEAT = 25, BTN_BLINK = 26;
const float MAX_CM = 250;      // más lejos que esto = nadie

float xs = 0.5, pres = 0;
int lastBeat = 1, lastBlink = 1;

float readCm(int trig, int echo) {
  digitalWrite(trig, LOW); delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = pulseIn(echo, HIGH, 20000);          // ~3.4 m máx
  return us == 0 ? 999 : us / 58.0f;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_L, OUTPUT); pinMode(ECHO_L, INPUT);
  pinMode(TRIG_R, OUTPUT); pinMode(ECHO_R, INPUT);
  pinMode(BTN_BEAT, INPUT_PULLUP); pinMode(BTN_BLINK, INPUT_PULLUP);
}

void loop() {
  float dl = readCm(TRIG_L, ECHO_L);
  delay(12);                                     // evita que un sensor escuche el eco del otro
  float dr = readCm(TRIG_R, ECHO_R);
  bool someone = dl < MAX_CM || dr < MAX_CM;
  if (someone) {
    // más cerca del sensor izquierdo → x hacia 0
    float cl = MAX_CM - min(dl, MAX_CM), cr = MAX_CM - min(dr, MAX_CM);
    float x = (cl + cr) > 0 ? cr / (cl + cr) : 0.5f;
    xs = xs * 0.8f + x * 0.2f;
  }
  pres = pres * 0.9f + (someone ? 1.0f : 0.0f) * 0.1f;
  Serial.printf("diosas.mirada.x %.3f\n", xs);
  Serial.printf("diosas.mirada.presencia %.3f\n", pres);

  int b = digitalRead(BTN_BEAT), k = digitalRead(BTN_BLINK);
  if (b == LOW && lastBeat == HIGH) Serial.println("diosas.ritmo.beat 1");
  if (k == LOW && lastBlink == HIGH) Serial.println("diosas.mirada.parpadear 1");
  lastBeat = b; lastBlink = k;
  delay(30);
}

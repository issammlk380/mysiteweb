// ═══════════════════════════════════════════════════════════════════════════
// 🏭 SYSTÈME ANDON KA01 - VERSION SIMPLE (Sans MQTT pour test Wokwi)
// ═══════════════════════════════════════════════════════════════════════════

// 🔌 PINS ESP32
#define LED_RED     13
#define LED_BLUE    16
#define LED_YELLOW  17
#define LED_ORANGE   4
#define LED_GREEN    2

#define BTN_DOWNTIME   12
#define BTN_MAINT      14
#define BTN_BREAK      27
#define BTN_MATERIAL   26
#define BTN_RESOLVE    25

// Variables
unsigned long lastDebounce[5] = {0};
bool lastButtonState[5] = {HIGH, HIGH, HIGH, HIGH, HIGH};
const int debounceDelay = 200;

// ═══════════════════════════════════════════════════════════════════════════
// 💡 GESTION DES LEDs
// ═══════════════════════════════════════════════════════════════════════════
void allLedsOff() {
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_BLUE, LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_ORANGE, LOW);
  digitalWrite(LED_GREEN, LOW);
  Serial.println("🔴🔵🟡🟠🟢 → Toutes LEDs OFF");
}

void setLed(int pin, const char* label, const char* phase) {
  allLedsOff();
  digitalWrite(pin, HIGH);
  Serial.println("════════════════════════════════════════");
  Serial.print("✅ LED ON: ");
  Serial.println(label);
  Serial.print("📍 Phase: ");
  Serial.println(phase);
  Serial.println("════════════════════════════════════════");
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔘 LECTURE BOUTON AVEC DEBOUNCE
// ═══════════════════════════════════════════════════════════════════════════
bool readButton(int pin, int index) {
  bool reading = digitalRead(pin);
  
  if (reading != lastButtonState[index]) {
    lastDebounce[index] = millis();
  }
  
  if ((millis() - lastDebounce[index]) > debounceDelay) {
    if (reading == LOW && lastButtonState[index] == HIGH) {
      lastButtonState[index] = reading;
      return true;
    }
  }
  
  lastButtonState[index] = reading;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n════════════════════════════════════════");
  Serial.println("  🏭 SYSTÈME ANDON KA01");
  Serial.println("  📋 Version Test Simple (Sans MQTT)");
  Serial.println("════════════════════════════════════════");
  
  // Configuration LEDs
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_ORANGE, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  
  // Test LEDs
  Serial.println("💡 Test LEDs...");
  digitalWrite(LED_RED, HIGH);    delay(200);
  digitalWrite(LED_BLUE, HIGH);   delay(200);
  digitalWrite(LED_YELLOW, HIGH); delay(200);
  digitalWrite(LED_ORANGE, HIGH); delay(200);
  digitalWrite(LED_GREEN, HIGH);  delay(300);
  allLedsOff();
  delay(300);
  
  // État initial: LED GREEN
  digitalWrite(LED_GREEN, HIGH);
  Serial.println("🟢 MODE: OPERATIONAL (LED GREEN ON)");
  
  // Configuration Boutons
  pinMode(BTN_DOWNTIME, INPUT_PULLUP);
  pinMode(BTN_MAINT, INPUT_PULLUP);
  pinMode(BTN_BREAK, INPUT_PULLUP);
  pinMode(BTN_MATERIAL, INPUT_PULLUP);
  pinMode(BTN_RESOLVE, INPUT_PULLUP);
  Serial.println("🔘 Boutons: 5 configurés");
  
  Serial.println("\n════════════════════════════════════════");
  Serial.println("  ✅ Système prêt!");
  Serial.println("  🎯 Appuyez sur les boutons pour tester");
  Serial.println("════════════════════════════════════════\n");
  
  Serial.println("📌 PINS:");
  Serial.println("   LEDs: RED=13 BLUE=16 YEL=17 ORG=4 GRN=2");
  Serial.println("   Btns: DWN=12 MNT=14 BRK=27 MAT=26 RES=25\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 LOOP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
void loop() {
  // 🔴 PHASE 1: DOWNTIME (Opérateur signale panne)
  if (readButton(BTN_DOWNTIME, 0)) {
    setLed(LED_RED, "🔴 DOWNTIME", "PHASE 1: DETECTED");
    Serial.println("ℹ️  Opérateur: Panne détectée");
    Serial.println("ℹ️  Backend devrait enregistrer: date_panne\n");
  }
  
  // 🔵 PHASE 2: MAINTENANCE (Technicien arrive)
  if (readButton(BTN_MAINT, 1)) {
    setLed(LED_BLUE, "🔵 MAINTENANCE", "PHASE 2: ACKNOWLEDGED");
    Serial.println("ℹ️  Technicien: Arrivé sur site");
    Serial.println("ℹ️  Backend devrait calculer: MTTA (temps réaction)\n");
  }
  
  // 🟡 BREAK (Pause)
  if (readButton(BTN_BREAK, 2)) {
    setLed(LED_YELLOW, "🟡 BREAK", "PAUSE");
    Serial.println("ℹ️  Opérateur: Pause\n");
  }
  
  // 🟠 MATERIAL (Manque matériel)
  if (readButton(BTN_MATERIAL, 3)) {
    setLed(LED_ORANGE, "🟠 MATERIAL", "ATTENTE MATÉRIEL");
    Serial.println("ℹ️  Opérateur: Manque matériel\n");
  }
  
  // 🟢 PHASE 3: RESOLVE (Réparation terminée)
  if (readButton(BTN_RESOLVE, 4)) {
    setLed(LED_GREEN, "🟢 RESOLVE", "PHASE 3: RESOLVED");
    Serial.println("ℹ️  Technicien: Réparation terminée");
    Serial.println("ℹ️  Backend devrait calculer: MTTR (temps total)\n");
    Serial.println("✅ Retour à l'état OPERATIONAL\n");
  }
  
  delay(10);
}

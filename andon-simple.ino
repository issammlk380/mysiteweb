// ═══════════════════════════════════════════════════════════════════
// ANDON KA01 - Wokwi ESP32 Simulator (LED GREEN = NORMAL)
// 5 Boutons: DOWNTIME | MAINTENANCE | BREAK | MATERIAL | RESOLVE
// + MQTT vers Dashboard Railway
// + Lifecycle: detected → acknowledged → resolved
//
// FIX: LED GREEN stays ON in Normal state (Operational)
// FIX: LED GREEN turns OFF when alert is active
// FIX: LED stays ON until RESOLVE button pressed
// FIX: MQTT reconnect stabilized
// FIX: Pins matched to diagram.json wiring
// FIX: Lifecycle phase tracking for MTTA/MTTR calculation
// ═══════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION WIFI
// ═══════════════════════════════════════════════════════════════════
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION MQTT BROKER
// ═══════════════════════════════════════════════════════════════════
const char* MQTT_HOST = "broker.hivemq.com";
const int   MQTT_PORT = 1883;

// Topics MQTT
const char* TOPIC_STATUS = "factory/ligne1/andon/alert";
const char* TOPIC_HEARTBEAT = "andon/zone/ka/machine/ka01/heartbeat";

// ═══════════════════════════════════════════════════════════════════
// PINS ESP32 - MATCHED TO diagram.json WIRING
// ═══════════════════════════════════════════════════════════════════
// LEDs (5 couleurs)
#define LED_RED     13   // 🔴 DOWNTIME
#define LED_BLUE    16   // 🔵 MAINTENANCE
#define LED_YELLOW  17   // 🟡 BREAK
#define LED_ORANGE   4   // 🟠 MATERIAL
#define LED_GREEN    2   // 🟢 RESOLVE / NORMAL

// Boutons (5 états)
#define BTN_DOWNTIME   12  // 🔴 Panne
#define BTN_MAINT      14  // 🔵 Maintenance
#define BTN_BREAK      27  // 🟡 Pause
#define BTN_MATERIAL   26  // 🟠 Manque Matériel
#define BTN_RESOLVE    25  // 🟢 Résolu

// RFID
#define RST_PIN  22
#define SS_PIN    5
MFRC522 rfid(SS_PIN, RST_PIN);

// ═══════════════════════════════════════════════════════════════════
// VARIABLES GLOBALES
// ═══════════════════════════════════════════════════════════════════
WiFiClient espClient;
PubSubClient mqtt(espClient);

unsigned long debounce[5] = {0};
unsigned long lastReconnect = 0;
unsigned long lastHeartbeat = 0;
bool mqttConnected = false;
int currentAlertLed = -1;  // LED li cha3la daba (-1 = mafich alert)
bool isNormal = true;       // État Normal (Operational)

const int btnPins[5] = {BTN_DOWNTIME, BTN_MAINT, BTN_BREAK, BTN_MATERIAL, BTN_RESOLVE};
const int ledPins[5] = {LED_RED, LED_BLUE, LED_YELLOW, LED_ORANGE, LED_GREEN};

const char* btnLabels[5] = {"DOWNTIME", "MAINTENANCE", "BREAK", "WAIT_MATERIAL", "OPERATIONAL"};
const char* alertTypes[5] = {"Panne machine", "Maintenance requise", "Pause opérateur", "Manque matériel", "Fonctionnement normal"};
const char* lifecyclePhases[5] = {"detected", "acknowledged", "in_progress", "in_progress", "resolved"};

// ═══════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n========================================");
  Serial.println("  🚀 Andon KA01 - 5 Alertes + MQTT");
  Serial.println("  [LED GREEN = NORMAL] ON par défaut");
  Serial.println("========================================");

  // Initialiser LEDs
  for (int i = 0; i < 5; i++) {
    pinMode(ledPins[i], OUTPUT);
  }

  // ✅ LED GREEN ON par défaut (État Normal)
  allLedsOff();
  digitalWrite(LED_GREEN, HIGH);
  isNormal = true;

  // Initialiser boutons
  for (int i = 0; i < 5; i++) {
    pinMode(btnPins[i], INPUT_PULLUP);
  }

  // RFID
  SPI.begin();
  rfid.PCD_Init();
  Serial.println("RFID MFRC522 prêt");

  // Connexion WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("🔌 WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println(" ✅ " + WiFi.localIP().toString());

  // Configuration MQTT
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);

  // Première connexion MQTT
  reconnectMQTT();

  Serial.println("========================================");
  Serial.println("  ✅ Prêt! État Normal: 🟢 LED GREEN ON");
  Serial.println("  🔴 Panne(12) | 🔵 Maint(14) | 🟡 Break(27)");
  Serial.println("  🟠 Mat(26) | 🟢 Res(25)");
  Serial.println("========================================\n");
}

// ═══════════════════════════════════════════════════════════════════
// LOOP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
void loop() {
  // Vérifier MQTT
  if (!mqtt.connected()) {
    mqttConnected = false;
    if (millis() - lastReconnect > 5000) {
      Serial.println("🔄 MQTT déconnecté, reconnexion...");
      reconnectMQTT();
      lastReconnect = millis();
    }
  } else {
    mqttConnected = true;
    mqtt.loop();
  }

  // Heartbeat toutes les 10 secondes
  if (millis() - lastHeartbeat > 10000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  // Lire les 5 boutons
  readButtons();
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS BOUTONS (LED GREEN = NORMAL + LIFECYCLE TRACKING)
// ═══════════════════════════════════════════════════════════════════
void readButtons() {
  // 🔴 BTN_DOWNTIME (Panne) - LED RED ON, LED GREEN OFF
  // Lifecycle: "detected" - Opérateur détecte la panne (14:30)
  if (digitalRead(BTN_DOWNTIME) == LOW && millis() - debounce[0] > 300) {
    debounce[0] = millis();
    setAlertLed(LED_RED);  // ← RED ON, GREEN OFF
    sendAlert(btnLabels[0], alertTypes[0], lifecyclePhases[0]);
    Serial.println("🔴 PHASE 1: DOWNTIME détecté (lifecycle: detected)");
  }

  // 🔵 BTN_MAINT (Maintenance) - LED BLUE ON, LED GREEN OFF
  // Lifecycle: "acknowledged" - Technicien arrive (14:45) → MTTA = 15 min
  if (digitalRead(BTN_MAINT) == LOW && millis() - debounce[1] > 300) {
    debounce[1] = millis();
    setAlertLed(LED_BLUE);  // ← BLUE ON, GREEN OFF
    sendAlert(btnLabels[1], alertTypes[1], lifecyclePhases[1]);
    Serial.println("🔵 PHASE 2: MAINTENANCE commencée (lifecycle: acknowledged)");
  }

  // 🟡 BTN_BREAK (Pause) - LED YELLOW ON, LED GREEN OFF
  // Lifecycle: "in_progress" - Pause opérateur
  if (digitalRead(BTN_BREAK) == LOW && millis() - debounce[2] > 300) {
    debounce[2] = millis();
    setAlertLed(LED_YELLOW);  // ← YELLOW ON, GREEN OFF
    sendAlert(btnLabels[2], alertTypes[2], lifecyclePhases[2]);
  }

  // 🟠 BTN_MATERIAL (Manque Matériel) - LED ORANGE ON, LED GREEN OFF
  // Lifecycle: "in_progress" - Attente matériel
  if (digitalRead(BTN_MATERIAL) == LOW && millis() - debounce[3] > 300) {
    debounce[3] = millis();
    setAlertLed(LED_ORANGE);  // ← ORANGE ON, GREEN OFF
    sendAlert(btnLabels[3], alertTypes[3], lifecyclePhases[3]);
  }

  // 🟢 BTN_RESOLVE (Résolu) - LED GREEN ON, alert LED OFF
  // Lifecycle: "resolved" - Réparation terminée (15:15) → MTTR = 30 min
  if (digitalRead(BTN_RESOLVE) == LOW && millis() - debounce[4] > 300) {
    debounce[4] = millis();
    setNormalState();  // ← GREEN ON, alert OFF
    sendAlert(btnLabels[4], alertTypes[4], lifecyclePhases[4]);
    Serial.println("🟢 PHASE 3: RESOLVED - Machine opérationnelle (lifecycle: resolved)");
    Serial.println("💡 État Normal: 🟢 LED GREEN ON");
  }
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS LED (LED GREEN = NORMAL)
// ═══════════════════════════════════════════════════════════════════

// ✅ Normal State: LED GREEN ON, alert LED OFF
void setNormalState() {
  allLedsOff();              // Turn off all LEDs
  digitalWrite(LED_GREEN, HIGH); // Turn on GREEN LED
  currentAlertLed = -1;      // No alert active
  isNormal = true;           // Normal state
}

// ✅ Alert State: Alert LED ON, LED GREEN OFF
void setAlertLed(int alertLed) {
  allLedsOff();              // Turn off all LEDs
  digitalWrite(alertLed, HIGH); // Turn on alert LED
  currentAlertLed = alertLed;   // Store current alert LED
  isNormal = false;          // Alert state
}

// Turn off all LEDs
void allLedsOff() {
  for (int i = 0; i < 5; i++) {
    digitalWrite(ledPins[i], LOW);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FONCTIONS MQTT (avec lifecycle_phase)
// ═══════════════════════════════════════════════════════════════════
void sendAlert(const char* status, const char* type, const char* lifecycle) {
  if (!mqtt.connected()) {
    Serial.println("❌ MQTT non connecté - Alerte non envoyée");
    return;
  }

  String json = "{";
  json += "\"machine_id\":\"KA01\",";
  json += "\"zone\":\"KA\",";
  json += "\"status\":\"" + String(status) + "\",";
  json += "\"type\":\"" + String(type) + "\",";
  json += "\"lifecycle_phase\":\"" + String(lifecycle) + "\",";
  json += "\"operator\":\"Op_0102\",";
  json += "\"timestamp\":" + String(millis());
  json += "}";

  Serial.println("📡 ALERTE: " + String(type) + " | Status: " + String(status));
  Serial.println("   📍 Lifecycle: " + String(lifecycle));
  if (isNormal) {
    Serial.println("   💡 État: Normal (🟢 LED GREEN ON)");
  } else {
    Serial.println("   ⚠️ État: Alerte (LED ON: " + String(currentAlertLed) + ")");
  }

  if (mqtt.publish(TOPIC_STATUS, json.c_str())) {
    Serial.println("   ✅ MQTT envoyé!");
  } else {
    Serial.println("   ❌ Échec envoi MQTT");
  }
}

void sendHeartbeat() {
  if (!mqtt.connected()) return;

  String json = "{";
  json += "\"machine_id\":\"KA01\",";
  json += "\"status\":\"heartbeat\",";
  json += "\"timestamp\":" + String(millis());
  json += "}";

  mqtt.publish(TOPIC_HEARTBEAT, json.c_str());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Pas besoin de recevoir pour l'instant
}

void reconnectMQTT() {
  if (mqtt.connected()) {
    mqttConnected = true;
    return;
  }

  String clientId = "Wokwi-KA01-" + String(random(0xffff), HEX);

  Serial.print("🔌 Connexion MQTT...");
  if (mqtt.connect(clientId.c_str())) {
    Serial.println(" ✅");
    mqtt.subscribe(TOPIC_STATUS);
    mqttConnected = true;
  } else {
    Serial.print(" ❌ Échec: ");
    Serial.println(mqtt.state());
    mqttConnected = false;
  }
}

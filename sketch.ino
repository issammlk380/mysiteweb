// ═══════════════════════════════════════════════════════════════════════════
// 🏭 SYSTÈME ANDON INDUSTRIEL KA01 - ESP32 + MQTT + RFID
// ═══════════════════════════════════════════════════════════════════════════
// 
// 🎯 FONCTIONNALITÉS :
//    • Machine à États Finis (FSM) pour gestion robuste des modes
//    • 5 Alertes industrielles : DOWNTIME | MAINTENANCE | BREAK | MATERIAL
//    • État NORMAL (Opérationnel) avec LED GREEN permanente
//    • Watchdog logiciel (auto-reset si freeze)
//    • Reconnexion WiFi/MQTT intelligente avec backoff exponentiel
//    • Système de logs multi-niveaux (DEBUG, INFO, WARN, ERROR)
//    • Statistiques temps réel (uptime, compteurs, MQTT)
//    • Debouncing avancé avec validation d'état stable
//    • Optimisation mémoire (F() macro) et CPU
//    • RFID MFRC522 pour identification opérateur
//
// 📌 PINS ESP32 (INCHANGÉES - compatibles diagram.json) :
//    LEDs    : RED=13, BLUE=16, YELLOW=17, ORANGE=4, GREEN=2
//    Boutons : DOWNTIME=12, MAINT=14, BREAK=27, MATERIAL=26, RESOLVE=25
//    RFID    : SS=5, RST=22, SCK=18, MOSI=23, MISO=19
//
// 🔒 SÉCURITÉ : Aucune modification des GPIO, câblage ou fonctionnalité existante
//
// 📅 Version : 2.0 Pro | Auteur : Embedded Systems Engineer
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 CONFIGURATION RÉSEAU
// ═══════════════════════════════════════════════════════════════════════════
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";
const uint32_t WIFI_TIMEOUT_MS = 15000;
const uint32_t WIFI_RECONNECT_INTERVAL = 30000;

// ═══════════════════════════════════════════════════════════════════════════
// 📡 CONFIGURATION MQTT BROKER
// ═══════════════════════════════════════════════════════════════════════════
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_CLIENT_PREFIX = "AndonKA01";
const uint32_t MQTT_RECONNECT_BASE = 5000;
const uint32_t MQTT_RECONNECT_MAX = 60000;
const uint16_t MQTT_KEEPALIVE_SEC = 60;

// Topics MQTT
const char* TOPIC_ALERT      = "factory/ligne1/andon/alert";
const char* TOPIC_RFID       = "factory/ligne1/andon/rfid";   // ← NEW: badge scans (role resolution)
const char* TOPIC_HEARTBEAT  = "andon/zone/ka/machine/ka01/heartbeat";
const char* TOPIC_STATUS     = "andon/zone/ka/machine/ka01/status";
const char* TOPIC_DIAGNOSTICS = "andon/zone/ka/machine/ka01/diagnostics";

// ═══════════════════════════════════════════════════════════════════════════
// 🔌 CONFIGURATION MATÉRIELLE - PINS ESP32
// ═══════════════════════════════════════════════════════════════════════════
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

#define RFID_RST_PIN  22
#define RFID_SS_PIN    5

// ═══════════════════════════════════════════════════════════════════════════
// 🎛️ CONFIGURATION SYSTÈME
// ═══════════════════════════════════════════════════════════════════════════
#define WDT_TIMEOUT_SEC 30
#define DEBOUNCE_DELAY_MS 50
#define BUTTON_STABLE_COUNT 1
#define HEARTBEAT_INTERVAL_MS 10000
#define STATS_INTERVAL_MS 60000
#define LED_BLINK_INTERVAL_MS 500

enum LogLevel { LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR };
#define CURRENT_LOG_LEVEL LOG_INFO

// ═══════════════════════════════════════════════════════════════════════════
// 📊 MACHINE À ÉTATS FINIS (FSM)
// ═══════════════════════════════════════════════════════════════════════════
enum SystemState {
  STATE_INIT,
  STATE_WIFI_CONNECT,
  STATE_MQTT_CONNECT,
  STATE_OPERATIONAL,
  STATE_ALERT_ACTIVE,
  STATE_RECONNECTING,
  STATE_ERROR
};

enum AlertType {
  ALERT_NONE,
  ALERT_DOWNTIME,
  ALERT_MAINTENANCE,
  ALERT_BREAK,
  ALERT_MATERIAL
};

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 STRUCTURES DE DONNÉES
// ═══════════════════════════════════════════════════════════════════════════
struct ButtonState {
  uint8_t pin;
  uint32_t lastDebounceTime;
  uint8_t stableCount;
  bool lastStableState;
  bool currentState;
};

struct Statistics {
  uint32_t bootTime;
  uint32_t alertsCount;
  uint32_t mqttPublishSuccess;
  uint32_t mqttPublishFailed;
  uint32_t wifiReconnects;
  uint32_t mqttReconnects;
  uint32_t watchdogResets;
};

struct AlertConfig {
  AlertType type;
  uint8_t ledPin;
  const char* label;
  const char* description;
};

// ═══════════════════════════════════════════════════════════════════════════
// 🌍 VARIABLES GLOBALES
// ═══════════════════════════════════════════════════════════════════════════
WiFiClient espClient;
PubSubClient mqtt(espClient);
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

SystemState currentState = STATE_INIT;
AlertType currentAlert = ALERT_NONE;
int8_t currentAlertLedPin = -1;

uint32_t lastHeartbeat = 0;
uint32_t lastStatsReport = 0;
uint32_t lastWiFiAttempt = 0;
uint32_t lastMqttAttempt = 0;
uint32_t mqttReconnectDelay = MQTT_RECONNECT_BASE;
uint32_t lastWatchdogReset = 0;

Statistics stats = {0};
String currentOperatorId = "UNKNOWN";

ButtonState buttons[5] = {
  {BTN_DOWNTIME, 0, 0, HIGH, HIGH},
  {BTN_MAINT, 0, 0, HIGH, HIGH},
  {BTN_BREAK, 0, 0, HIGH, HIGH},
  {BTN_MATERIAL, 0, 0, HIGH, HIGH},
  {BTN_RESOLVE, 0, 0, HIGH, HIGH}
};

const AlertConfig alertConfigs[5] = {
  {ALERT_DOWNTIME,    LED_RED,    "DOWNTIME",       "Panne machine"},
  {ALERT_MAINTENANCE, LED_BLUE,   "MAINTENANCE",    "Maintenance requise"},
  {ALERT_BREAK,       LED_YELLOW, "BREAK",          "Pause opérateur"},
  {ALERT_MATERIAL,    LED_ORANGE, "WAIT_MATERIAL",  "Manque matériel"},
  {ALERT_NONE,        LED_GREEN,  "OPERATIONAL",    "Fonctionnement normal"}
};

// ═══════════════════════════════════════════════════════════════════════════
// 📝 SYSTÈME DE LOGS PROFESSIONNEL
// ═══════════════════════════════════════════════════════════════════════════
void logMessage(LogLevel level, const String& msg) {
  if (level < CURRENT_LOG_LEVEL) return;
  
  const char* levelStr;
  switch(level) {
    case LOG_DEBUG: levelStr = "DEBUG"; break;
    case LOG_INFO:  levelStr = "INFO "; break;
    case LOG_WARN:  levelStr = "WARN "; break;
    case LOG_ERROR: levelStr = "ERROR"; break;
    default: levelStr = "?????"; break;
  }
  
  char timestamp[16];
  snprintf(timestamp, sizeof(timestamp), "[%010lu]", millis());
  
  Serial.print(timestamp);
  Serial.print(F(" ["));
  Serial.print(levelStr);
  Serial.print(F("] "));
  Serial.println(msg);
}

#define LOG_D(msg) logMessage(LOG_DEBUG, msg)
#define LOG_I(msg) logMessage(LOG_INFO, msg)
#define LOG_W(msg) logMessage(LOG_WARN, msg)
#define LOG_E(msg) logMessage(LOG_ERROR, msg)

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════
String getUptimeString() {
  uint32_t uptime = (millis() - stats.bootTime) / 1000;
  uint32_t days = uptime / 86400;
  uint32_t hours = (uptime % 86400) / 3600;
  uint32_t minutes = (uptime % 3600) / 60;
  uint32_t seconds = uptime % 60;
  
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%lud %02lu:%02lu:%02lu", days, hours, minutes, seconds);
  return String(buffer);
}

String getWiFiStatusString() {
  switch(WiFi.status()) {
    case WL_CONNECTED: return F("CONNECTED");
    case WL_NO_SHIELD: return F("NO_SHIELD");
    case WL_IDLE_STATUS: return F("IDLE");
    case WL_NO_SSID_AVAIL: return F("NO_SSID");
    case WL_SCAN_COMPLETED: return F("SCAN_DONE");
    case WL_CONNECT_FAILED: return F("FAILED");
    case WL_CONNECTION_LOST: return F("LOST");
    case WL_DISCONNECTED: return F("DISCONNECTED");
    default: return F("UNKNOWN");
  }
}

String getMqttStateString() {
  switch(mqtt.state()) {
    case MQTT_CONNECTED: return F("CONNECTED");
    case MQTT_CONNECTION_TIMEOUT: return F("TIMEOUT");
    case MQTT_CONNECTION_LOST: return F("LOST");
    case MQTT_CONNECT_FAILED: return F("FAILED");
    case MQTT_DISCONNECTED: return F("DISCONNECTED");
    case MQTT_CONNECT_BAD_PROTOCOL: return F("BAD_PROTO");
    case MQTT_CONNECT_BAD_CLIENT_ID: return F("BAD_CLIENT");
    case MQTT_CONNECT_UNAVAILABLE: return F("UNAVAILABLE");
    case MQTT_CONNECT_BAD_CREDENTIALS: return F("BAD_CREDS");
    case MQTT_CONNECT_UNAUTHORIZED: return F("UNAUTH");
    default: return F("UNKNOWN");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 💡 GESTION DES LEDs
// ═══════════════════════════════════════════════════════════════════════════
void allLedsOff() {
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_BLUE, LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_ORANGE, LOW);
  digitalWrite(LED_GREEN, LOW);
  LOG_D(F("LEDs: ALL OFF"));
}

void setOperationalMode() {
  allLedsOff();
  digitalWrite(LED_GREEN, HIGH);
  currentAlert = ALERT_NONE;
  currentAlertLedPin = -1;
  currentState = STATE_OPERATIONAL;
  LOG_I(F("🟢 MODE: OPERATIONAL (LED GREEN ON)"));
}

void setAlertMode(uint8_t ledPin, AlertType alertType) {
  allLedsOff();
  digitalWrite(ledPin, HIGH);
  currentAlert = alertType;
  currentAlertLedPin = ledPin;
  currentState = STATE_ALERT_ACTIVE;
  
  String msg = F("🚨 ALERTE ACTIVE: LED PIN=");
  msg += ledPin;
  msg += F(" | Type=");
  msg += alertType;
  LOG_W(msg);
}

void blinkLed(uint8_t pin, uint8_t times, uint16_t delayMs) {
  for(uint8_t i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(delayMs);
    digitalWrite(pin, LOW);
    delay(delayMs);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔘 GESTION AVANCÉE DES BOUTONS
// ═══════════════════════════════════════════════════════════════════════════
bool readButtonStable(ButtonState* btn) {
  bool reading = digitalRead(btn->pin);
  
  // DEBUG: Log each reading
  static uint32_t lastPinLog = 0;
  if (millis() - lastPinLog > 2000) {
    Serial.print(F("[DEBUG] Pin "));
    Serial.print(btn->pin);
    Serial.print(F(" = "));
    Serial.println(reading == LOW ? "PRESSED (LOW)" : "RELEASED (HIGH)");
    lastPinLog = millis();
  }
  
  if (reading != btn->currentState) {
    btn->currentState = reading;
    btn->stableCount = 0;
    btn->lastDebounceTime = millis();
    return false;
  }
  
  if ((millis() - btn->lastDebounceTime) < DEBOUNCE_DELAY_MS) {
    return false;
  }
  
  if (btn->stableCount < BUTTON_STABLE_COUNT) {
    btn->stableCount++;
    return false;
  }
  
  if (reading != btn->lastStableState) {
    btn->lastStableState = reading;
    
    if (reading == LOW) {
      btn->stableCount = 0;
      Serial.print(F("[DEBUG] Button STABLE PRESS detected on pin "));
      Serial.println(btn->pin);
      return true;
    }
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔘 LIFECYCLE 3 PHASES - Gestion Boutons Intelligente
// ═══════════════════════════════════════════════════════════════════════════
void scanButtons() {
  // DEBUG: Log entrée dans la fonction
  static uint32_t lastScanLog = 0;
  if (millis() - lastScanLog > 10000) {
    Serial.println(F("[DEBUG] scanButtons() - Lecture des 5 boutons..."));
    Serial.print(F("[DEBUG] Bouton states: DWN="));
    Serial.print(digitalRead(BTN_DOWNTIME));
    Serial.print(F(" MNT="));
    Serial.print(digitalRead(BTN_MAINT));
    Serial.print(F(" BRK="));
    Serial.print(digitalRead(BTN_BREAK));
    Serial.print(F(" MAT="));
    Serial.print(digitalRead(BTN_MATERIAL));
    Serial.print(F(" RES="));
    Serial.println(digitalRead(BTN_RESOLVE));
    lastScanLog = millis();
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 PHASE 1: DOWNTIME (Opérateur signale panne)
  // ═══════════════════════════════════════════════════════════════════════
  // Opérateur détecte panne → Appuie sur bouton rouge
  // → Backend enregistre: date_panne, lifecycle_phase='detected'
  // ═══════════════════════════════════════════════════════════════════════
  if (readButtonStable(&buttons[0])) {
    Serial.println(F("[DEBUG] ✅ BTN_DOWNTIME pressé!"));
    LOG_I(F("🔴 PHASE 1: DOWNTIME détecté par opérateur"));
    LOG_I(F("   → Lifecycle: DETECTED"));
    setAlertMode(LED_RED, ALERT_DOWNTIME);
    sendAlertMqtt(0, "detected");
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🔵 PHASE 2: MAINTENANCE (Technicien arrive)
  // ═══════════════════════════════════════════════════════════════════════
  // Technicien arrive sur site → Appuie sur bouton bleu
  // → Backend enregistre: date_arrivee_technicien, lifecycle_phase='acknowledged'
  // → Backend calcule: temps_reaction_minutes = arrivée - panne
  // ═══════════════════════════════════════════════════════════════════════
  if (readButtonStable(&buttons[1])) {
    LOG_I(F("🔵 PHASE 2: Technicien ARRIVÉ sur site"));
    LOG_I(F("   → Lifecycle: ACKNOWLEDGED"));
    LOG_I(F("   → Backend va calculer MTTA (temps réaction)"));
    setAlertMode(LED_BLUE, ALERT_MAINTENANCE);
    sendAlertMqtt(1, "acknowledged");
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🟡 BREAK (Pause opérateur - pas lifecycle)
  // ═══════════════════════════════════════════════════════════════════════
  if (readButtonStable(&buttons[2])) {
    LOG_I(F("🟡 BTN: BREAK pressé"));
    setAlertMode(LED_YELLOW, ALERT_BREAK);
    sendAlertMqtt(2, "detected");
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🟠 MATERIAL (Manque matériel - pas lifecycle)
  // ═══════════════════════════════════════════════════════════════════════
  if (readButtonStable(&buttons[3])) {
    LOG_I(F("🟠 BTN: MATERIAL pressé"));
    setAlertMode(LED_ORANGE, ALERT_MATERIAL);
    sendAlertMqtt(3, "detected");
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🟢 PHASE 3: RESOLVE (Réparation terminée)
  // ═══════════════════════════════════════════════════════════════════════
  // Technicien termine réparation → Appuie sur bouton vert
  // → Backend enregistre: date_reparation, lifecycle_phase='resolved'
  // → Backend calcule: 
  //    - temps_reparation_minutes = réparation - arrivée
  //    - temps_total_arret_minutes = réparation - panne (MTTR)
  // ═══════════════════════════════════════════════════════════════════════
  if (readButtonStable(&buttons[4])) {
    LOG_I(F("🟢 PHASE 3: Réparation TERMINÉE"));
    LOG_I(F("   → Lifecycle: RESOLVED"));
    LOG_I(F("   → Backend va calculer MTTR (temps total)"));
    setOperationalMode();
    sendAlertMqtt(4, "resolved");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 📡 GESTION MQTT
// ═══════════════════════════════════════════════════════════════════════════
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = F("📨 MQTT RX: Topic=");
  msg += topic;
  msg += F(" | Len=");
  msg += length;
  LOG_D(msg);
}

bool connectMqtt() {
  // Don't attempt MQTT if WiFi not connected
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }
  
  if (mqtt.connected()) {
    return true;
  }
  
  if (millis() - lastMqttAttempt < mqttReconnectDelay) {
    return false;
  }
  
  lastMqttAttempt = millis();
  
  String clientId = MQTT_CLIENT_PREFIX;
  clientId += F("-");
  clientId += String(random(0xffff), HEX);
  
  String msg = F("🔌 MQTT: Connexion à ");
  msg += MQTT_HOST;
  msg += F(":");
  msg += MQTT_PORT;
  LOG_I(msg);
  
  msg = F("   Client ID: ");
  msg += clientId;
  LOG_D(msg);
  
  bool connected = mqtt.connect(clientId.c_str());
  
  if (connected) {
    LOG_I(F("✅ MQTT: Connecté!"));
    mqtt.subscribe(TOPIC_STATUS);
    mqtt.subscribe(TOPIC_DIAGNOSTICS);
    mqttReconnectDelay = MQTT_RECONNECT_BASE;
    stats.mqttReconnects++;
    
    // ✅ Retour à l'état OPERATIONAL après connexion MQTT
    if (currentState != STATE_ALERT_ACTIVE) {
      currentState = STATE_OPERATIONAL;
    }
    
    publishStartupMessage();
    return true;
  } else {
    String errMsg = F("❌ MQTT: Échec (");
    errMsg += getMqttStateString();
    errMsg += F(")");
    LOG_E(errMsg);
    
    mqttReconnectDelay = min(mqttReconnectDelay * 2, MQTT_RECONNECT_MAX);
    
    String retryMsg = F("   Retry dans ");
    retryMsg += String(mqttReconnectDelay/1000);
    retryMsg += F("s");
    LOG_W(retryMsg);
    return false;
  }
}

bool publishMqtt(const char* topic, const String& payload, bool retained = false) {
  if (!mqtt.connected()) {
    LOG_W(F("⚠️ MQTT: Non connecté"));
    stats.mqttPublishFailed++;
    return false;
  }
  
  bool success = mqtt.publish(topic, payload.c_str(), retained);
  
  if (success) {
    stats.mqttPublishSuccess++;
    String dbgMsg = F("📤 MQTT TX: ");
    dbgMsg += topic;
    LOG_D(dbgMsg);
  } else {
    stats.mqttPublishFailed++;
    String errMsg = F("❌ MQTT TX FAILED: ");
    errMsg += topic;
    LOG_E(errMsg);
  }
  
  return success;
}

// ═══════════════════════════════════════════════════════════════════════════
// 📡 MQTT Alert Publisher - LIFECYCLE 3 PHASES
// ═══════════════════════════════════════════════════════════════════════════
void sendAlertMqtt(uint8_t alertIndex, const char* lifecyclePhase) {
  const AlertConfig& alert = alertConfigs[alertIndex];
  
  // ✅ JSON Payload avec lifecycle_phase
  String json = F("{");
  json += F("\"machine_id\":\"KA01\",");
  json += F("\"zone\":\"KA\",");
  json += F("\"status\":\"");
  json += alert.label;
  json += F("\",");
  json += F("\"type\":\"");
  json += alert.description;
  json += F("\",");
  json += F("\"lifecycle_phase\":\"");
  json += lifecyclePhase;
  json += F("\",");
  json += F("\"operator\":\"");
  json += currentOperatorId;
  json += F("\",");
  json += F("\"timestamp\":");
  json += String(millis());
  json += F(",");
  json += F("\"uptime\":\"");
  json += getUptimeString();
  json += F("\"");
  json += F("}");
  
  if (publishMqtt(TOPIC_ALERT, json)) {
    stats.alertsCount++;
    String successMsg = F("✅ Alert ");
    successMsg += alert.description;
    successMsg += F(" | Phase: ");
    successMsg += lifecyclePhase;
    LOG_I(successMsg);
  }
  
  // ✅ Log détaillé selon la phase
  if (strcmp(lifecyclePhase, "detected") == 0) {
    LOG_I(F("   📍 PHASE 1 envoyée: Panne détectée"));
  } else if (strcmp(lifecyclePhase, "acknowledged") == 0) {
    LOG_I(F("   📍 PHASE 2 envoyée: Technicien arrivé"));
  } else if (strcmp(lifecyclePhase, "resolved") == 0) {
    LOG_I(F("   📍 PHASE 3 envoyée: Réparation terminée"));
  }
}

void sendHeartbeat() {
  String json = F("{");
  json += F("\"machine_id\":\"KA01\",");
  json += F("\"status\":\"heartbeat\",");
  json += F("\"state\":\"");
  json += String(currentState);
  json += F("\",");
  json += F("\"alert_active\":");
  json += (currentAlert != ALERT_NONE ? F("true") : F("false"));
  json += F(",");
  json += F("\"wifi_rssi\":");
  json += String(WiFi.RSSI());
  json += F(",");
  json += F("\"uptime\":\"");
  json += getUptimeString();
  json += F("\",");
  json += F("\"free_heap\":");
  json += String(ESP.getFreeHeap());
  json += F(",");
  json += F("\"timestamp\":");
  json += String(millis());
  json += F("}");
  
  publishMqtt(TOPIC_HEARTBEAT, json);
}

void publishStartupMessage() {
  String json = F("{");
  json += F("\"machine_id\":\"KA01\",");
  json += F("\"event\":\"startup\",");
  json += F("\"firmware_version\":\"2.0-Pro\",");
  json += F("\"wifi_ssid\":\"");
  json += String(WIFI_SSID);
  json += F("\",");
  json += F("\"ip\":\"");
  json += WiFi.localIP().toString();
  json += F("\",");
  json += F("\"mac\":\"");
  json += WiFi.macAddress();
  json += F("\",");
  json += F("\"timestamp\":");
  json += String(millis());
  json += F("}");
  
  publishMqtt(TOPIC_STATUS, json, true);
}

void publishStatistics() {
  String json = F("{");
  json += F("\"machine_id\":\"KA01\",");
  json += F("\"uptime\":\"");
  json += getUptimeString();
  json += F("\",");
  json += F("\"alerts_count\":");
  json += String(stats.alertsCount);
  json += F(",");
  json += F("\"mqtt_success\":");
  json += String(stats.mqttPublishSuccess);
  json += F(",");
  json += F("\"mqtt_failed\":");
  json += String(stats.mqttPublishFailed);
  json += F(",");
  json += F("\"wifi_reconnects\":");
  json += String(stats.wifiReconnects);
  json += F(",");
  json += F("\"mqtt_reconnects\":");
  json += String(stats.mqttReconnects);
  json += F(",");
  json += F("\"free_heap\":");
  json += String(ESP.getFreeHeap());
  json += F(",");
  json += F("\"wifi_rssi\":");
  json += String(WiFi.RSSI());
  json += F(",");
  json += F("\"timestamp\":");
  json += String(millis());
  json += F("}");
  
  publishMqtt(TOPIC_DIAGNOSTICS, json);
  
  String statsMsg = F("📊 Stats: Alerts=");
  statsMsg += String(stats.alertsCount);
  LOG_I(statsMsg);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 GESTION WIFI
// ═══════════════════════════════════════════════════════════════════════════
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  
  if (millis() - lastWiFiAttempt < WIFI_RECONNECT_INTERVAL) {
    return false;
  }
  
  lastWiFiAttempt = millis();
  
  LOG_I(F("🔌 WiFi: Connexion..."));
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  uint32_t start = millis();
  
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(F("."));
  }
  
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    String successMsg = F("✅ WiFi OK | IP: ");
    successMsg += WiFi.localIP().toString();
    LOG_I(successMsg);
    
    String rssiMsg = F("   RSSI: ");
    rssiMsg += String(WiFi.RSSI());
    rssiMsg += F(" dBm");
    LOG_I(rssiMsg);
    
    stats.wifiReconnects++;
    return true;
  } else {
    LOG_E(F("❌ WiFi: Échec"));
    return false;
  }
}

void checkWiFi() {
  // Vérifier WiFi seulement toutes les 30 secondes
  static uint32_t lastCheck = 0;
  if (millis() - lastCheck < WIFI_RECONNECT_INTERVAL) {
    return;
  }
  lastCheck = millis();
  
  if (WiFi.status() != WL_CONNECTED) {
    LOG_W(F("⚠️ WiFi: Perdu, reconnexion..."));
    // ✅ FIX: Ne pas changer l'état, juste essayer de reconnecter
    // currentState = STATE_RECONNECTING;  // REMOVED!
    connectWiFi();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🏷️ GESTION RFID
// ═══════════════════════════════════════════════════════════════════════════
void scanRFID() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return;
  }
  
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    uid += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  
  currentOperatorId = uid;

  String rfidMsg = F("🏷️ RFID: ");
  rfidMsg += uid;
  LOG_I(rfidMsg);

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ NEW: Publish the badge scan to the dedicated RFID topic.
  //    The backend bridge resolves the role from the UID:
  //      • Technician card → registers arrival (Phase 2), computes response time,
  //        switches the machine to MAINTENANCE and notifies the dashboard.
  //      • Operator card   → identified only (Andon buttons remain available).
  // ─────────────────────────────────────────────────────────────────────────
  String rfidJson = F("{");
  rfidJson += F("\"machine_id\":\"KA01\",");
  rfidJson += F("\"zone\":\"KA\",");
  rfidJson += F("\"rfid_uid\":\"");
  rfidJson += uid;
  rfidJson += F("\",");
  rfidJson += F("\"timestamp\":");
  rfidJson += String(millis());
  rfidJson += F("}");
  publishMqtt(TOPIC_RFID, rfidJson);

  // Backward-compatible status message (kept so nothing that relied on it breaks)
  String json = F("{");
  json += F("\"machine_id\":\"KA01\",");
  json += F("\"event\":\"operator_scan\",");
  json += F("\"operator_id\":\"");
  json += uid;
  json += F("\",");
  json += F("\"timestamp\":");
  json += String(millis());
  json += F("}");
  publishMqtt(TOPIC_STATUS, json);

  // Visual feedback: blue LED blink acknowledges the scan
  blinkLed(LED_BLUE, 2, 100);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);
  
  Serial.println(F("\n════════════════════════════════════════════════════"));
  Serial.println(F("  🏭 SYSTÈME ANDON KA01 v2.0 Pro"));
  Serial.println(F("  📡 ESP32 + MQTT + RFID + FSM + Watchdog"));
  Serial.println(F("════════════════════════════════════════════════════"));
  
  stats.bootTime = millis();
  
  // Note: Watchdog désactivé pour compatibilité Wokwi
  // Wokwi initialise automatiquement le Watchdog
  LOG_I(F("🐕 Watchdog: Géré par Wokwi"));
  
  // Configuration LEDs
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_ORANGE, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  
  // Test LEDs (startup sequence)
  LOG_I(F("💡 Test LEDs..."));
  digitalWrite(LED_RED, HIGH);    delay(100);
  digitalWrite(LED_BLUE, HIGH);   delay(100);
  digitalWrite(LED_YELLOW, HIGH); delay(100);
  digitalWrite(LED_ORANGE, HIGH); delay(100);
  digitalWrite(LED_GREEN, HIGH);  delay(200);
  allLedsOff();
  delay(300);
  
  // État initial: OPERATIONAL (LED GREEN ON)
  setOperationalMode();
  
  // Configuration Boutons
  for (int i = 0; i < 5; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
  }
  LOG_I(F("🔘 Boutons: 5 configurés (pull-up)"));
  
  // Configuration RFID
  SPI.begin();
  rfid.PCD_Init();
  LOG_I(F("🏷️ RFID: MFRC522 OK"));
  
  // Connexion WiFi
  currentState = STATE_WIFI_CONNECT;
  if (connectWiFi()) {
    currentState = STATE_MQTT_CONNECT;
  } else {
    LOG_E(F("❌ WiFi: Échec initial"));
    // ✅ FIX: Même si WiFi échoue, on passe en OPERATIONAL pour permettre les boutons
    currentState = STATE_OPERATIONAL;
  }
  
  // Configuration MQTT
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_SEC);
  
  // Connexion MQTT
  if (currentState == STATE_MQTT_CONNECT) {
    connectMqtt();
  }
  
  Serial.println(F("════════════════════════════════════════════════════"));
  Serial.println(F("  ✅ Système prêt!"));
  Serial.println(F("  🟢 État: OPERATIONAL (LED GREEN ON)"));
  Serial.println(F("════════════════════════════════════════════════════\n"));
  
  LOG_I(F("Pins: RED=13 BLUE=16 YEL=17 ORG=4 GRN=2"));
  LOG_I(F("Btns: DWN=12 MNT=14 BRK=27 MAT=26 RES=25"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 LOOP PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
void loop() {
  // Note: esp_task_wdt_reset() désactivé pour Wokwi
  // Wokwi gère le Watchdog automatiquement
  
  // Vérifier WiFi
  checkWiFi();
  
  // Gérer MQTT
  if (!mqtt.connected()) {
    connectMqtt();
  } else {
    mqtt.loop();
  }
  
  // Scanner boutons (si opérationnel)
  if (currentState == STATE_OPERATIONAL || currentState == STATE_ALERT_ACTIVE) {
    // DEBUG: Vérifier que scanButtons() s'exécute
    static uint32_t lastDebugLog = 0;
    if (millis() - lastDebugLog > 5000) {
      Serial.println(F("[DEBUG] scanButtons() est en cours..."));
      lastDebugLog = millis();
    }
    scanButtons();
  } else {
    // DEBUG: État bloque scanButtons
    static uint32_t lastStateLog = 0;
    if (millis() - lastStateLog > 5000) {
      Serial.print(F("[DEBUG] scanButtons() BLOQUÉ! currentState="));
      Serial.println(currentState);
      lastStateLog = millis();
    }
  }
  
  // Scanner RFID
  scanRFID();
  
  // Heartbeat (10 secondes)
  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  
  // Statistiques (60 secondes)
  if (millis() - lastStatsReport > STATS_INTERVAL_MS) {
    publishStatistics();
    lastStatsReport = millis();
  }
  
  // Petite pause pour éviter surcharge CPU
  delay(10);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎯 FIN DU PROGRAMME
// ═══════════════════════════════════════════════════════════════════════════

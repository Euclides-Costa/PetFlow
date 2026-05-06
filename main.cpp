#include <HX711.h>
#include <WiFi.h>
#include <HTTPClient.h>

// 🔌 PINOS
#define pinDT 4
#define pinSCK 16
#define pinBotao 15

// 🌐 WIFI
const char* ssid = "nome do wifi";
const char* password = "senha";

// 🔗 BACKEND
const char* serverName = "http://seu ip:3000/peso";

// ⚖️ CALIBRAÇÃO
float escala = 8300.0f;  // 🔧 

// 📊 CONTROLE
float medida = 0;
float pesoBase = 0;
bool taraAtiva = false;

float pesoFiltrado = 0;

unsigned long lastSend = 0;

HX711 scale;

// -----------------------------

void conectarWiFi() {
  Serial.print("Conectando ao WiFi");

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi conectado!");
  Serial.print("IP do ESP32: ");
  Serial.println(WiFi.localIP());
}

// -----------------------------

float getPesoLiquido() {
  float leitura = scale.get_units(10);

  // 🔥 filtro (suaviza)
  pesoFiltrado = 0.7 * pesoFiltrado + 0.3 * leitura;

  if (taraAtiva) {
    float pesoLiquido = pesoFiltrado - pesoBase;
    if (pesoLiquido < 0) pesoLiquido = 0;
    return pesoLiquido;
  }

  return pesoFiltrado;
}

// -----------------------------

void enviarPeso(float peso) {
  if (WiFi.status() == WL_CONNECTED) {

    HTTPClient http;

    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    String json = "{\"peso\": " + String(peso, 3) + "}";

    int httpResponseCode = http.POST(json);

    Serial.print("Enviado: ");
    Serial.print(peso, 3);
    Serial.print(" | HTTP: ");
    Serial.println(httpResponseCode);

    http.end();
  }
}

// -----------------------------

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(pinBotao, INPUT_PULLUP);

  Serial.println("Inicializando sistema...");

  conectarWiFi();

  scale.begin(pinDT, pinSCK);
  scale.set_scale(escala);

  delay(2000);
  scale.tare();

  Serial.println("Sistema pronto!");
}

// -----------------------------

void loop() {

  // 🔘 BOTÃO TARA
  if (digitalRead(pinBotao) == LOW) {

    if (!taraAtiva) {
      pesoBase = pesoFiltrado;
      taraAtiva = true;
      Serial.println("Tara ativada");
    } else {
      taraAtiva = false;
      pesoBase = 0;
      Serial.println("Tara desativada");
    }

    delay(500);
  }

  // 📊 LEITURA
  medida = getPesoLiquido();

  // 🔧 remove ruído próximo de zero
  if (medida < 0.01 && medida > -0.01) {
    medida = 0;
  }

  Serial.print("Peso: ");
  Serial.print(medida, 3);
  Serial.println(" kg");

  // 📡 ENVIA A CADA 5s
  if (millis() - lastSend > 5000) {
    enviarPeso(medida);
    lastSend = millis();
  }

  delay(300);
}
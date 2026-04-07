#include "HX711.h"

#define DT 4
#define SCK 16
#define BOTAO 15

HX711 scale;

// 🔧 AJUSTAR APÓS CALIBRAÇÃO
float fator_calibracao = 28.0;

float peso_filtrado = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(BOTAO, INPUT_PULLUP);

  scale.begin(DT, SCK);
  scale.set_scale(fator_calibracao);
  scale.tare();

  Serial.println("Balança pronta");
}

void loop() {

  // 🔘 BOTÃO DE TARA
  if (digitalRead(BOTAO) == LOW) {
    Serial.println("Tara acionada!");

    scale.tare();

    // 🔥 MUITO IMPORTANTE: zera o filtro
    peso_filtrado = 0;

    delay(500); // debounce
  }

  // 📊 leitura do sensor
  float leitura = scale.get_units(10);

  // 🔥 filtro (rápido e estável)
  peso_filtrado = 0.7 * peso_filtrado + 0.3 * leitura;

  // 🔧 elimina ruído próximo de zero
  if (peso_filtrado < 0.02 && peso_filtrado > -0.02) {
    peso_filtrado = 0;
  }

  // 📊 formatação brasileira
  String peso_str = String(peso_filtrado, 3);
  peso_str.replace('.', ',');

  // 📺 exibição contínua
  Serial.print("Peso: ");
  Serial.print(peso_str);
  Serial.println(" Kg");

  delay(200);
}
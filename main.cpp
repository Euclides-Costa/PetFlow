#include <HX711.h>

// DEFINIÇÕES DE PINOS PARA ESP32
#define pinDT 4
#define pinSCK 16
#define pinBotao 15

// DEFINIÇÕES
#define pesoMin 0.010
#define pesoMax 30.0
#define escala -351666.0f
#define DEBOUNCE_DELAY 50

HX711 scale;
float medida = 0;
float pesoBase = 0;  // Armazena o peso de referência (tara)
bool taraAtiva = false;  // Indica se a tara está ativa
int lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
bool buttonPressed = false;

// Função para ler o botão com debounce
bool lerBotao() {
    int reading = digitalRead(pinBotao);
    
    if (reading != lastButtonState) {
        lastDebounceTime = millis();
    }
    
    if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
        if (reading != buttonPressed) {
            buttonPressed = reading;
            if (buttonPressed == LOW) {
                lastButtonState = reading;
                return true;
            }
        }
    }
    
    lastButtonState = reading;
    return false;
}

void setup() {
    Serial.begin(115200);
    delay(200);
    
    // Configurar o pino do botão com pull-up interno
    pinMode(pinBotao, INPUT_PULLUP);
    
    Serial.println("Inicializando ESP32...");
    scale.begin(pinDT, pinSCK);
    scale.set_scale(escala);
    delay(2000);
    scale.tare();
    
    Serial.println("Setup Finalizado!");
    Serial.println("Leitura contínua iniciada...");
    Serial.println("Instruções:");
    Serial.println("- Coloque um recipiente vazio na balança e pressione o botão");
    Serial.println("- O peso do recipiente será desconsiderado");
    Serial.println("- Apenas o conteúdo adicional será exibido");
    Serial.println("--------------------------------");
}

float getPesoLiquido() {
    float pesoAtual = scale.get_units(5);
    
    if (taraAtiva) {
        // Retorna apenas o peso que excede o pesoBase
        float pesoLiquido = pesoAtual - pesoBase;
        if (pesoLiquido < 0) pesoLiquido = 0;  // Não mostra valores negativos
        return pesoLiquido;
    } else {
        return pesoAtual;
    }
}

void loop() {
    scale.power_up();
    delay(50);
    
    // VERIFICA SE O BOTÃO FOI PRESSIONADO (TARA)
    if (lerBotao()) {
        if (!taraAtiva) {
            // Primeira vez: configura a tara com o peso atual
            pesoBase = scale.get_units(10);  // Média de 10 leituras para maior precisão
            taraAtiva = true;
            Serial.println("========================================");
            Serial.print(">>> TARA CONFIGURADA! <<<");
            Serial.print(" Peso base desconsiderado: ");
            Serial.print(pesoBase, 3);
            Serial.println(" kg");
            Serial.println("Agora mostrando apenas o peso adicional");
            Serial.println("========================================");
        } else {
            // Segunda vez: zera a tara (volta a mostrar o peso total)
            taraAtiva = false;
            pesoBase = 0;
            Serial.println("========================================");
            Serial.println(">>> TARA CANCELADA! <<<");
            Serial.println("Agora mostrando o peso total novamente");
            Serial.println("========================================");
        }
        delay(100);  // Delay para evitar múltiplas leituras
    }
    
    // LEITURA DO PESO
    medida = getPesoLiquido();
    
    // EXIBE O RESULTADO
    if (medida <= pesoMin && medida > -pesoMin) {
        if (taraAtiva) {
            Serial.println("Peso adicional: 0.000 kg");
        } else {
            Serial.println("Peso: 0.000 kg");
        }
    } else if (medida >= pesoMax) {
        if (taraAtiva) {
            Serial.print("ALERTA - Peso adicional máximo excedido: ");
        } else {
            Serial.print("ALERTA - Peso máximo excedido: ");
        }
        Serial.print(medida, 3);
        Serial.println(" kg");
    } else {
        if (taraAtiva) {
            Serial.print("Peso adicional: ");
        } else {
            Serial.print("Peso: ");
        }
        Serial.print(medida, 3);
        Serial.println(" kg");
    }
    
    scale.power_down();
    delay(100);
}
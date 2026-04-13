# 🐾 PetFlow

Sistema inteligente de monitoramento alimentar para pets utilizando ESP32 e sensor de peso.

---

## 📌 Descrição

O **PetFlow** é um pote de ração inteligente que monitora automaticamente a quantidade de alimento consumida pelo pet. Utilizando uma célula de carga com o módulo HX711, o sistema mede o peso da ração e permite o acompanhamento via aplicativo.

O sistema também pode gerar alertas caso o animal não se alimente corretamente, auxiliando no cuidado com sua saúde.

---

## 🚀 Funcionalidades

- 📊 Monitoramento do consumo de ração em tempo real  
- 📱 Integração com aplicativo  
- 🔔 Notificações de alimentação irregular  
- ⚖️ Medição de peso com célula de carga  
- 📈 Histórico de consumo  

---

## 🛠️ Tecnologias Utilizadas

- Arduino IDE  
- Sensor de peso (Load Cell)  
- Módulo HX711  
- Comunicação (Wi-Fi ou Bluetooth)  

---

## 🔌 Componentes

- Esp32 
- Célula de carga  
- Módulo HX711  
- Jumpers  
- Fonte de alimentação  

---

## ⚙️ Funcionamento

O sistema utiliza uma célula de carga para medir o peso da ração. O sinal é amplificado pelo módulo HX711 e lido pelo Arduino.

Fluxo:
1. Registra o peso inicial  
2. Monitora variações (consumo)  
3. Envia dados para o app  
4. Dispara alertas se necessário  

---

## 🔧 Montagem

### HX711 → Esp32
- VCC → 5V  
- GND → GND  
- DT → D3  
- SCK → D2  

### Load Cell → HX711
- Vermelho → E+  
- Preto → E-  
- Branco → A-  
- Verde → A+  

---

## 💻 Como Executar

1. Instale a Arduino IDE  
2. Conecte o Esp32  
3. Instale a biblioteca **HX711**  
4. Envie o código  
5. Abra o Serial Monitor  

---

## 🎥 Referência

https://youtu.be/Y1W7OLxHuDw?si=WUwXQwVMzvJIynbQ

---

## 📊 Próximos Passos

- Integração com app/site  
- Dashboard com gráficos  
- Notificações em tempo real  
- Alimentação automática  

---

## 📌 Autor

**Euclides Benício e Arthur Augusto**

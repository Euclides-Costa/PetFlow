# 🐾 PetFlow

> Pote de ração inteligente com monitoramento alimentar em tempo real, dashboard web e assistente de IA.

---

## 📌 Descrição

O **PetFlow** é um sistema completo de monitoramento alimentar para pets. Um ESP32 com célula de carga mede continuamente o peso da ração e envia os dados para um servidor Node.js, que os processa e os exibe em um dashboard web com gráficos, histórico e insights gerados por inteligência artificial.

O sistema detecta padrões de consumo, emite alertas quando o pet não se alimenta, prevê quando a ração vai acabar e disponibiliza um chat com IA veterinária contextualizada com os dados reais do animal.

---

## 🚀 Funcionalidades

### Hardware
- ⚖️ Medição contínua do peso da ração via célula de carga + HX711
- 📡 Envio automático de leituras via Wi-Fi a cada 5 segundos
- 🔌 Alimentado via USB ou fonte 5V

### Backend
- 🔐 Autenticação segura com JWT (cadastro e login de usuários)
- 📦 Armazenamento local com SQLite
- 🔔 Alertas automáticos se o pet não se alimentar por mais de 8 horas
- 🧠 Análise de IA com detecção de anomalias e geração de insights
- 💬 Chat com IA veterinária contextualizada com dados reais do pet
- 📊 API REST completa com endpoints documentados

### Dashboard Web
- 📈 Gráficos de consumo diário (barras, linha ou área)
- 🗂️ KPIs: consumo total, média diária, maior/menor consumo, peso atual
- 🔍 Filtros por período personalizáveis
- 📤 Exportação de dados em CSV e JSON
- 🤖 Seção de insights inteligentes com análise automática
- 💬 Chat flutuante com o PetFlow AI (histórico persistente)

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Hardware | ESP32 + Célula de Carga + HX711 |
| Firmware | Arduino IDE / C++ |
| Backend | Node.js + Express |
| Banco de Dados | SQLite (via sqlite3) |
| Autenticação | JWT (jsonwebtoken + bcryptjs) |
| IA | Groq API (llama-3.1-8b-instant) |
| Frontend | HTML + CSS + JavaScript + Chart.js |

---

## 🔌 Componentes de Hardware

- ESP32 (com Wi-Fi integrado)
- Célula de carga (0–5 kg)
- Módulo HX711
- Jumpers e estrutura do pote

### Pinagem HX711 → ESP32

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| DT | GPIO 4 |
| SCK | GPIO 5 |

### Célula de Carga → HX711

| Fio | HX711 |
|---|---|
| Vermelho | E+ |
| Preto | E- |
| Branco | A- |
| Verde | A+ |

---

## 📁 Estrutura do Projeto

```
PetFlow/
├── backend/
│   ├── server.js          # Servidor Express + endpoints + lógica de IA
│   ├── petflow.db         # Banco SQLite (gerado automaticamente)
│   ├── .env               # Variáveis de ambiente (não versionar)
│   └── package.json
├── frontend/
│   ├── login.html
│   ├── cadastro.html
│   └── dashboard.html
└── firmware/
    └── petflow.ino        # Código do ESP32
```

---

## ⚙️ Como Executar

### Pré-requisitos
- Node.js 18+
- npm
- Conta na [Groq](https://console.groq.com) (gratuita) para a IA

### 1. Clonar o repositório

```bash
git clone https://github.com/seu-usuario/petflow.git
cd petflow
```

### 2. Instalar dependências do backend

```bash
cd backend
npm install
```

### 3. Configurar variáveis de ambiente

Crie um arquivo `.env` dentro da pasta `backend/`:

```env
GROQ_API_KEY=sua_chave_groq_aqui
```

> Obtenha sua chave gratuita em [console.groq.com](https://console.groq.com) → API Keys → Create API Key.

### 4. Iniciar o servidor

```bash
node server.js
```

O terminal exibirá o endereço IP local. Acesse pelo navegador:

```
http://localhost:3000
```

### 5. Firmware (ESP32)

1. Abra o arquivo `firmware/petflow.ino` na Arduino IDE
2. Instale as bibliotecas: **HX711** e **ArduinoJson**
3. Configure o Wi-Fi e o endereço IP do servidor no código
4. Faça o upload para o ESP32

---

## 🧠 Inteligência Artificial

O sistema utiliza a **Groq API** com o modelo `llama-3.1-8b-instant` para:

- Gerar insights sobre os padrões de alimentação
- Detectar anomalias (queda de apetite, aumento excessivo, pote tombado)
- Prever quando a ração vai acabar
- Responder perguntas em linguagem natural sobre o pet via chat

Todos os **cálculos numéricos** (médias, variações, tendências) são feitos localmente no backend — a IA é usada apenas para interpretar os dados e gerar respostas em linguagem natural.

Se a `GROQ_API_KEY` não estiver configurada, o sistema funciona normalmente com respostas geradas localmente como fallback.

---

## 🗄️ Banco de Dados

| Tabela | Descrição |
|---|---|
| `usuarios` | Cadastro e autenticação de tutores |
| `pesos` | Leituras de peso do ESP32 |
| `config` | Configurações por usuário |
| `analises_ai` | Histórico de análises automáticas da IA |
| `chat_mensagens` | Histórico do chat com o PetFlow AI |

---

## 🔗 Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/cadastrar` | Cadastro de usuário |
| POST | `/api/login` | Login |
| GET | `/api/verificar` | Verificar token JWT |
| POST | `/peso` | Receber leitura do ESP32 |
| GET | `/pesos` | Listar leituras |
| GET | `/alertas/verificar` | Verificar alertas de alimentação |
| POST | `/api/ai/analisar` | Gerar análise de IA |
| GET | `/api/ai/historico` | Histórico de análises |
| GET | `/api/chat/historico` | Histórico do chat |
| POST | `/api/chat/mensagem` | Enviar mensagem ao chat |
| DELETE | `/api/chat/historico` | Limpar histórico do chat |

---

## 👥 Autores

**Euclides Benício** e **Arthur Augusto**
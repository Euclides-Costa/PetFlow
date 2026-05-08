const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");

const app = express();

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const JWT_SECRET = "petflow_secret_key_2024";
const JWT_EXPIRES_IN = "7d";

// ============================================================
// FUNÇÕES PARA DATA/HORA LOCAL DO BRASIL (UTC-3)
// ============================================================

function getDataHoraBrasil() {
    const agora = new Date();
    const offsetBrasil = -3;
    const utc = agora.getTime() + (agora.getTimezoneOffset() * 60000);
    return new Date(utc + (offsetBrasil * 3600000));
}

function formatarDataHoraExibicao(data) {
    const dia = data.getDate().toString().padStart(2, '0');
    const mes = (data.getMonth() + 1).toString().padStart(2, '0');
    const ano = data.getFullYear();
    const hora = data.getHours().toString().padStart(2, '0');
    const minuto = data.getMinutes().toString().padStart(2, '0');
    const segundo = data.getSeconds().toString().padStart(2, '0');
    return `${dia}/${mes}/${ano} ${hora}:${minuto}:${segundo}`;
}

function formatarDataHoraSQL(data) {
    const ano = data.getFullYear();
    const mes = (data.getMonth() + 1).toString().padStart(2, '0');
    const dia = data.getDate().toString().padStart(2, '0');
    const hora = data.getHours().toString().padStart(2, '0');
    const minuto = data.getMinutes().toString().padStart(2, '0');
    const segundo = data.getSeconds().toString().padStart(2, '0');
    return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
}

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ============================================================
// CAMINHO DO FRONTEND (FORA DA PASTA BACKEND)
// ============================================================
// O frontend está na pasta raiz do projeto, ao lado da pasta backend
const frontendPath = path.join(__dirname, '..', 'frontend');

// Verificar se a pasta frontend existe
if (!fs.existsSync(frontendPath)) {
    console.error(`❌ Pasta frontend não encontrada em: ${frontendPath}`);
    console.log('📁 Certifique-se de que a pasta "frontend" existe ao lado da pasta "backend"');
    console.log('📁 Estrutura esperada:');
    console.log('   PetFlow/');
    console.log('   ├── backend/');
    console.log('   │   └── server.js');
    console.log('   └── frontend/');
    console.log('       ├── login.html');
    console.log('       ├── cadastro.html');
    console.log('       └── dashboard.html');
} else {
    console.log(`✅ Frontend encontrado em: ${frontendPath}`);
}

// Servir arquivos estáticos do frontend
app.use(express.static(frontendPath));

// ============================================================
// BANCO DE DADOS
// ============================================================
const db = new sqlite3.Database(path.join(__dirname, "petflow.db"));

// Criar tabela de usuários
db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        raca_animal TEXT,
        nome_racao TEXT,
        data_criacao TEXT,
        ultimo_login TEXT
    )
`);

// Criar tabela de pesos (associada ao usuário)
db.run(`
    CREATE TABLE IF NOT EXISTS pesos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        valor REAL,
        data TEXT,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
`);

// Criar tabela de configurações por usuário
db.run(`
    CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        chave TEXT,
        valor TEXT,
        data_atualizacao TEXT,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
        UNIQUE(usuario_id, chave)
    )
`);

// ============================================================
// ENDPOINTS DE AUTENTICAÇÃO
// ============================================================

// 📝 Cadastro de usuário
app.post("/api/cadastrar", async (req, res) => {
    const { nome, email, senha, confirmarSenha, raca_animal, nome_racao } = req.body;

    if (!nome || !email || !senha || !confirmarSenha) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    if (senha !== confirmarSenha) {
        return res.status(400).json({ error: "As senhas não coincidem." });
    }

    if (senha.length < 6) {
        return res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Email inválido." });
    }

    try {
        const emailExistente = await new Promise((resolve) => {
            db.get("SELECT id FROM usuarios WHERE email = ?", [email], (err, row) => {
                resolve(row);
            });
        });

        if (emailExistente) {
            return res.status(400).json({ error: "Este email já está cadastrado." });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        const dataCriacao = formatarDataHoraSQL(getDataHoraBrasil());

        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO usuarios (nome, email, senha, raca_animal, nome_racao, data_criacao)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [nome, email, senhaHash, raca_animal || null, nome_racao || null, dataCriacao],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        db.run(
            `INSERT INTO config (usuario_id, chave, valor, data_atualizacao)
             VALUES (?, 'alerta_horas', '8', ?),
                    (?, 'limite_maximo_kg', '5', ?),
                    (?, 'filtro_leituras', '5', ?)`,
            [result, agora, result, agora, result, agora]
        );

        const token = jwt.sign(
            { id: result, email: email, nome: nome },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            success: true,
            message: "Cadastro realizado com sucesso!",
            token: token,
            usuario: {
                id: result,
                nome: nome,
                email: email,
                raca_animal: raca_animal || null,
                nome_racao: nome_racao || null
            }
        });

    } catch (error) {
        console.error("Erro no cadastro:", error);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// 🔐 Login de usuário
app.post("/api/login", async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: "Email e senha são obrigatórios." });
    }

    try {
        const usuario = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!usuario) {
            return res.status(401).json({ error: "Email ou senha inválidos." });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: "Email ou senha inválidos." });
        }

        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        db.run("UPDATE usuarios SET ultimo_login = ? WHERE id = ?", [agora, usuario.id]);

        const token = jwt.sign(
            { id: usuario.id, email: usuario.email, nome: usuario.nome },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            message: "Login realizado com sucesso!",
            token: token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                raca_animal: usuario.raca_animal,
                nome_racao: usuario.nome_racao
            }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// 🔒 Verificar token
app.get("/api/verificar", autenticarToken, async (req, res) => {
    try {
        const usuario = await new Promise((resolve, reject) => {
            db.get(
                "SELECT id, nome, email, raca_animal, nome_racao FROM usuarios WHERE id = ?",
                [req.usuario.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!usuario) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        res.json({
            valido: true,
            usuario: usuario
        });
    } catch (error) {
        res.status(500).json({ error: "Erro interno." });
    }
});

// Middleware para verificar token
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Acesso negado. Token não fornecido." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: "Token inválido ou expirado." });
    }
}

// ============================================================
// ENDPOINTS DE PESOS
// ============================================================

app.post("/peso", autenticarToken, (req, res) => {
    let { peso } = req.body;
    const usuario_id = req.usuario.id;

    if (peso === undefined || peso === null) {
        return res.status(400).json({ error: "Peso não informado" });
    }

    peso = parseFloat(peso);

    if (peso < 0) {
        console.log(`⚠️ Valor negativo ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "negative value" });
    }

    if (peso > 10) {
        console.log(`⚠️ Valor muito alto ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "value too high" });
    }

    const dataHoraBrasil = getDataHoraBrasil();
    const dataFormatada = formatarDataHoraSQL(dataHoraBrasil);
    const dataExibicao = formatarDataHoraExibicao(dataHoraBrasil);

    console.log(`📊 [Usuário ${usuario_id}] Peso salvo: ${peso.toFixed(3)} kg - ${dataExibicao}`);

    db.run(
        "INSERT INTO pesos (usuario_id, valor, data) VALUES (?, ?, ?)",
        [usuario_id, peso, dataFormatada],
        function(err) {
            if (err) {
                console.error("Erro ao salvar:", err);
                return res.status(500).json({ error: err.message });
            }
            res.json({
                status: "ok",
                id: this.lastID,
                peso: peso,
                timestamp: dataExibicao
            });
        }
    );
});

app.get("/pesos", autenticarToken, (req, res) => {
    const { limite = 500 } = req.query;
    const usuario_id = req.usuario.id;

    db.all(
        "SELECT * FROM pesos WHERE usuario_id = ? AND valor >= 0 ORDER BY id DESC LIMIT ?",
        [usuario_id, limite],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        }
    );
});

app.get("/alertas/verificar", autenticarToken, (req, res) => {
    const usuario_id = req.usuario.id;
    const dataLimite = new Date(getDataHoraBrasil());
    dataLimite.setHours(dataLimite.getHours() - 8);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite);

    db.get(`
        SELECT
            MAX(data) as ultima_vez,
            MAX(CASE WHEN valor > 0.05 THEN data ELSE NULL END) as ultimo_consumo
        FROM pesos
        WHERE usuario_id = ? AND valor >= 0 AND data >= ?
    `, [usuario_id, dataLimiteStr], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const alertaAtivo = !row?.ultimo_consumo;

        res.json({
            alerta: alertaAtivo,
            ultimo_consumo: row?.ultimo_consumo || null,
            ultima_leitura: row?.ultima_vez || null,
            mensagem: alertaAtivo ? "⚠️ Seu pet pode não estar se alimentando há mais de 8 horas!" : "✅ Seu pet está se alimentando normalmente"
        });
    });
});

// ============================================================
// ROTAS DE PÁGINAS (frontend separado)
// ============================================================

app.get('/login', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(frontendPath, 'cadastro.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(frontendPath, 'dashboard.html'));
});

app.get('/api', (req, res) => {
    res.json({
        nome: "PetFlow API",
        versao: "3.0.0",
        fuso_horario: "America/Sao_Paulo (UTC-3)",
        horario_servidor: formatarDataHoraExibicao(getDataHoraBrasil()),
        endpoints: {
            "POST /api/cadastrar": "Cadastro de usuário",
            "POST /api/login": "Login de usuário",
            "POST /peso": "Enviar peso (requer token)",
            "GET /pesos": "Listar pesos (requer token)",
            "GET /alertas/verificar": "Verificar alertas (requer token)"
        }
    });
});

app.get('/', (req, res) => {
    res.redirect('/login');
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;

function getLocalIp() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
    console.log("\n========================================");
    console.log("🚀 PetFlow Backend v3.0 - Com Autenticação");
    console.log("========================================");
    console.log(`🕐 Horário do servidor: ${formatarDataHoraExibicao(getDataHoraBrasil())}`);
    console.log(`📡 Servidor: http://${getLocalIp()}:${PORT}`);
    console.log(`🔐 Login: http://${getLocalIp()}:${PORT}/login`);
    console.log(`📝 Cadastro: http://${getLocalIp()}:${PORT}/cadastro`);
    console.log(`📊 Dashboard: http://${getLocalIp()}:${PORT}/dashboard`);
    console.log("========================================");
    console.log(`📁 Frontend: ${frontendPath}`);
    console.log("========================================\n");
});
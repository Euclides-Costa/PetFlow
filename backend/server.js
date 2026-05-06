const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();

// ============================================================
// FUNÇÕES PARA DATA/HORA LOCAL DO BRASIL (UTC-3)
// ============================================================

// Função para obter data/hora local do Brasil
function getDataHoraBrasil() {
    const agora = new Date();
    // Converter para UTC-3 (Brasília)
    const offsetBrasil = -3;
    const utc = agora.getTime() + (agora.getTimezoneOffset() * 60000);
    return new Date(utc + (offsetBrasil * 3600000));
}

// Formatar para exibição (DD/MM/AAAA HH:MM:SS)
function formatarDataHoraExibicao(data) {
    const dia = data.getDate().toString().padStart(2, '0');
    const mes = (data.getMonth() + 1).toString().padStart(2, '0');
    const ano = data.getFullYear();
    const hora = data.getHours().toString().padStart(2, '0');
    const minuto = data.getMinutes().toString().padStart(2, '0');
    const segundo = data.getSeconds().toString().padStart(2, '0');
    return `${dia}/${mes}/${ano} ${hora}:${minuto}:${segundo}`;
}

// Formatar para SQLite (YYYY-MM-DD HH:MM:SS)
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
// CONFIGURAÇÃO CORS
// ============================================================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ============================================================
// SERVIDOR ESTÁTICO PARA O FRONTEND
// ============================================================
app.use(express.static(path.join(__dirname, 'frontend')));

// Rota principal - Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ============================================================
// BANCO DE DADOS (com campo data como TEXT)
// ============================================================
const db = new sqlite3.Database(path.join(__dirname, "pesos.db"));

// Criar tabela principal (data como TEXT para armazenar formato brasileiro)
db.run(`
    CREATE TABLE IF NOT EXISTS pesos (
                                         id INTEGER PRIMARY KEY AUTOINCREMENT,
                                         valor REAL,
                                         data TEXT
    )
`);

// Criar tabela de configurações
db.run(`
    CREATE TABLE IF NOT EXISTS config (
                                          chave TEXT PRIMARY KEY,
                                          valor TEXT,
                                          data_atualizacao TEXT
    )
`, (err) => {
    if (err) {
        console.log("⚠️ Tabela config já existe ou erro:", err.message);
    } else {
        console.log("✅ Tabela config criada com sucesso");
        const agora = formatarDataHoraSQL(getDataHoraBrasil());
        db.run(`INSERT OR IGNORE INTO config (chave, valor, data_atualizacao) VALUES ('alerta_horas', '8', ?)`, [agora]);
        db.run(`INSERT OR IGNORE INTO config (chave, valor, data_atualizacao) VALUES ('limite_maximo_kg', '5', ?)`, [agora]);
        db.run(`INSERT OR IGNORE INTO config (chave, valor, data_atualizacao) VALUES ('filtro_leituras', '5', ?)`, [agora]);
    }
});

// Limpar dados negativos existentes
db.run("DELETE FROM pesos WHERE valor < 0", [], (err) => {
    if (!err) {
        console.log("🧹 Dados negativos verificados");
    }
});

// ============================================================
// ENDPOINTS PRINCIPAIS
// ============================================================

// 📡 Receber dados do ESP32 (com data gerada pelo JavaScript)
app.post("/peso", (req, res) => {
    let { peso } = req.body;

    if (peso === undefined || peso === null) {
        return res.status(400).json({ error: "Peso não informado" });
    }

    peso = parseFloat(peso);

    if (peso < 0) {
        console.log(`⚠️ Valor negativo ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "negative value", peso: peso });
    }

    if (peso > 10) {
        console.log(`⚠️ Valor muito alto ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "value too high", peso: peso });
    }

    // Usar JavaScript para obter o horário local correto do Brasil
    const dataHoraBrasil = getDataHoraBrasil();
    const dataFormatada = formatarDataHoraSQL(dataHoraBrasil);
    const dataExibicao = formatarDataHoraExibicao(dataHoraBrasil);

    console.log(`📊 Peso salvo: ${peso.toFixed(3)} kg - ${dataExibicao}`);

    db.run(
        "INSERT INTO pesos (valor, data) VALUES (?, ?)",
        [peso, dataFormatada],
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

// 📊 Histórico completo
app.get("/pesos", (req, res) => {
    const { limite = 500 } = req.query;
    db.all(
        "SELECT * FROM pesos WHERE valor >= 0 ORDER BY id DESC LIMIT ?",
        [limite],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        }
    );
});

// 📅 Histórico com filtro de data
app.get("/pesos/filtro", (req, res) => {
    let { inicio, fim, limite = 1000 } = req.query;
    let query = "SELECT * FROM pesos WHERE valor >= 0";
    let params = [];

    if (inicio) {
        query += " AND date(data) >= date(?)";
        params.push(inicio);
    }
    if (fim) {
        query += " AND date(data) <= date(?)";
        params.push(fim);
    }

    query += " ORDER BY id DESC LIMIT ?";
    params.push(limite);

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📊 Consumo agregado por período
app.get("/consumo/periodo", (req, res) => {
    let { inicio, fim, grupo = "dia" } = req.query;
    let groupBy = "";

    switch(grupo) {
        case "hora":
            groupBy = "substr(data, 1, 13)";
            break;
        case "dia":
            groupBy = "substr(data, 1, 10)";
            break;
        case "semana":
            groupBy = "strftime('%Y-%W', data)";
            break;
        case "mes":
            groupBy = "substr(data, 1, 7)";
            break;
        default:
            groupBy = "substr(data, 1, 10)";
    }

    let query = `
        SELECT
            ${groupBy} as periodo,
            MIN(valor) as peso_minimo,
            MAX(valor) as peso_maximo,
            AVG(valor) as peso_medio,
            COUNT(*) as leituras
        FROM pesos
        WHERE valor >= 0
    `;
    let params = [];

    if (inicio) {
        query += " AND date(data) >= date(?)";
        params.push(inicio);
    }
    if (fim) {
        query += " AND date(data) <= date(?)";
        params.push(fim);
    }

    query += " GROUP BY periodo ORDER BY periodo";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 🍖 Consumo total
app.get("/consumo/total", (req, res) => {
    let { inicio, fim } = req.query;
    let query = "SELECT valor, data FROM pesos WHERE valor >= 0 ORDER BY id ASC";
    let params = [];

    if (inicio) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND date(data) >= date(?) ORDER BY id ASC";
        params.push(inicio);
    }
    if (fim && params.length > 0) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND date(data) >= date(?) AND date(data) <= date(?) ORDER BY id ASC";
        params.push(fim);
    } else if (fim) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND date(data) <= date(?) ORDER BY id ASC";
        params.push(fim);
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let consumoTotal = 0;
        for (let i = 1; i < rows.length; i++) {
            const diferenca = rows[i-1].valor - rows[i].valor;
            if (diferenca > 0) {
                consumoTotal += diferenca;
            }
        }

        res.json({
            total_consumo_kg: parseFloat(consumoTotal.toFixed(3)),
            numero_leituras: rows.length,
            periodo_inicio: inicio || rows[0]?.data,
            periodo_fim: fim || rows[rows.length-1]?.data
        });
    });
});

// 📅 Consumo do dia
app.get("/consumo/dia", (req, res) => {
    const hoje = formatarDataHoraSQL(getDataHoraBrasil()).split(' ')[0];

    db.all(`
        SELECT
            substr(data, 1, 10) as dia,
            SUM(valor) as total,
            COUNT(*) as leituras,
            MIN(valor) as minimo,
            MAX(valor) as maximo
        FROM pesos
        WHERE substr(data, 1, 10) = ? AND valor >= 0
        GROUP BY substr(data, 1, 10)
    `, [hoje], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📆 Consumo da semana
app.get("/consumo/semana", (req, res) => {
    const hoje = getDataHoraBrasil();
    const dataLimite = new Date(hoje);
    dataLimite.setDate(hoje.getDate() - 7);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite).split(' ')[0];

    db.all(`
        SELECT
            strftime('%w', data) as dia_semana,
            CASE strftime('%w', data)
                WHEN '0' THEN 'Domingo'
                WHEN '1' THEN 'Segunda'
                WHEN '2' THEN 'Terça'
                WHEN '3' THEN 'Quarta'
                WHEN '4' THEN 'Quinta'
                WHEN '5' THEN 'Sexta'
                WHEN '6' THEN 'Sábado'
                END as nome_dia,
            SUM(valor) as total,
            AVG(valor) as media,
            COUNT(*) as leituras
        FROM pesos
        WHERE substr(data, 1, 10) >= ? AND valor >= 0
        GROUP BY dia_semana
        ORDER BY dia_semana
    `, [dataLimiteStr], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📅 Consumo do mês
app.get("/consumo/mes", (req, res) => {
    const hoje = getDataHoraBrasil();
    const dataLimite = new Date(hoje);
    dataLimite.setDate(hoje.getDate() - 30);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite).split(' ')[0];

    db.all(`
        SELECT
            strftime('%W', data) as semana,
            'Semana ' || (strftime('%W', data) - strftime('%W', ?) + 1) as nome_semana,
            SUM(valor) as total,
            AVG(valor) as media,
            COUNT(*) as leituras,
            MIN(valor) as minimo,
            MAX(valor) as maximo
        FROM pesos
        WHERE substr(data, 1, 10) >= ? AND valor >= 0
        GROUP BY semana
        ORDER BY semana
    `, [dataLimiteStr, dataLimiteStr], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📊 Dashboard resumo
app.get("/dashboard", (req, res) => {
    const hoje = formatarDataHoraSQL(getDataHoraBrasil()).split(' ')[0];
    const dataLimite7 = new Date(getDataHoraBrasil());
    dataLimite7.setDate(dataLimite7.getDate() - 7);
    const dataLimite30 = new Date(getDataHoraBrasil());
    dataLimite30.setDate(dataLimite30.getDate() - 30);
    const dataLimite7Str = formatarDataHoraSQL(dataLimite7).split(' ')[0];
    const dataLimite30Str = formatarDataHoraSQL(dataLimite30).split(' ')[0];

    db.get(`
        SELECT
            COALESCE((SELECT SUM(valor) FROM pesos WHERE substr(data, 1, 10) = ? AND valor >= 0), 0) as consumo_hoje,
            COALESCE((SELECT SUM(valor) FROM pesos WHERE substr(data, 1, 10) >= ? AND valor >= 0), 0) as consumo_semana,
            COALESCE((SELECT SUM(valor) FROM pesos WHERE substr(data, 1, 10) >= ? AND valor >= 0), 0) as consumo_mes,
            COALESCE((SELECT COUNT(*) FROM pesos WHERE valor >= 0), 0) as total_leituras,
            COALESCE((SELECT valor FROM pesos WHERE valor >= 0 ORDER BY id DESC LIMIT 1), 0) as ultimo_peso,
            (SELECT data FROM pesos WHERE valor >= 0 ORDER BY id DESC LIMIT 1) as ultima_atualizacao
    `, [hoje, dataLimite7Str, dataLimite30Str], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row);
    });
});

// 📈 Estatísticas
app.get("/estatisticas", (req, res) => {
    db.get(`
        SELECT
            COALESCE(MIN(valor), 0) as peso_minimo,
            COALESCE(MAX(valor), 0) as peso_maximo,
            COALESCE(AVG(valor), 0) as peso_medio,
            COUNT(*) as total_leituras,
            SUM(CASE WHEN valor < 0.1 THEN 1 ELSE 0 END) as leituras_vazio,
            SUM(CASE WHEN valor > 1 THEN 1 ELSE 0 END) as leituras_acima_1kg
        FROM pesos
        WHERE valor >= 0
    `, [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row);
    });
});

// ⚙️ Configurações
app.get("/config", (req, res) => {
    db.all("SELECT * FROM config", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const config = {};
        rows.forEach(row => {
            config[row.chave] = row.valor;
        });
        res.json(config);
    });
});

app.put("/config/:chave", (req, res) => {
    const { chave } = req.params;
    const { valor } = req.body;
    const agora = formatarDataHoraSQL(getDataHoraBrasil());

    db.run(
        "INSERT OR REPLACE INTO config (chave, valor, data_atualizacao) VALUES (?, ?, ?)",
        [chave, valor, agora],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ status: "ok", chave, valor });
        }
    );
});

// 🗑️ Limpar dados antigos
app.delete("/dados/limpar", (req, res) => {
    const { dias = 30 } = req.query;
    const dataLimite = new Date(getDataHoraBrasil());
    dataLimite.setDate(dataLimite.getDate() - dias);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite);

    db.run(
        "DELETE FROM pesos WHERE data < ? AND valor >= 0",
        [dataLimiteStr],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                status: "ok",
                registros_removidos: this.changes,
                mensagem: `Removidos registros com mais de ${dias} dias`
            });
        }
    );
});

// 📤 Exportar CSV
app.get("/exportar/csv", (req, res) => {
    db.all("SELECT id, valor, data FROM pesos WHERE valor >= 0 ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let csv = "id,peso_kg,data_hora\n";
        rows.forEach(row => {
            csv += `${row.id},${row.valor},${row.data}\n`;
        });

        res.header("Content-Type", "text/csv");
        res.attachment(`petflow_dados_${formatarDataHoraSQL(getDataHoraBrasil()).replace(/[-\s:]/g, '-')}.csv`);
        res.send(csv);
    });
});

// 📤 Exportar JSON
app.get("/exportar/json", (req, res) => {
    db.all("SELECT * FROM pesos WHERE valor >= 0 ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        res.json({
            exportado_em: formatarDataHoraExibicao(getDataHoraBrasil()),
            total_registros: rows.length,
            dados: rows
        });
    });
});

// 🔔 Verificar alertas
app.get("/alertas/verificar", (req, res) => {
    const dataLimite = new Date(getDataHoraBrasil());
    dataLimite.setHours(dataLimite.getHours() - 8);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite);

    db.get(`
        SELECT 
            MAX(data) as ultima_vez,
            MAX(CASE WHEN valor > 0.05 THEN data ELSE NULL END) as ultimo_consumo
        FROM pesos 
        WHERE valor >= 0 AND data >= ?
    `, [dataLimiteStr], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const alertaAtivo = !row?.ultimo_consumo;

        res.json({
            alerta: alertaAtivo,
            ultimo_consumo: row?.ultimo_consumo || null,
            ultima_leitura: row?.ultima_vez || null,
            mensagem: alertaAtivo ? "⚠️ Pet pode não estar se alimentando há mais de 8 horas!" : "✅ Pet está se alimentando normalmente"
        });
    });
});

// 🔍 Debug
app.get("/admin/consultar", (req, res) => {
    db.get("SELECT COUNT(*) as total FROM pesos", [], (err, count) => {
        if (err) {
            return res.status(500).json({ erro: err.message });
        }

        db.all("SELECT * FROM pesos ORDER BY id DESC LIMIT 20", [], (err, rows) => {
            if (err) {
                return res.status(500).json({ erro: err.message });
            }

            res.json({
                fuso_horario: "America/Sao_Paulo (UTC-3)",
                horario_servidor: formatarDataHoraExibicao(getDataHoraBrasil()),
                total_registros: count.total,
                ultimos_registros: rows
            });
        });
    });
});

// Rota para documentação da API
app.get("/api", (req, res) => {
    res.json({
        nome: "PetFlow API",
        versao: "2.0.0",
        fuso_horario: "America/Sao_Paulo (UTC-3)",
        horario_servidor: formatarDataHoraExibicao(getDataHoraBrasil()),
        endpoints: {
            "POST /peso": "Enviar peso",
            "GET /pesos": "Histórico",
            "GET /dashboard": "Resumo",
            "GET /estatisticas": "Estatísticas",
            "GET /exportar/csv": "Exportar CSV",
            "GET /admin/consultar": "Debug"
        }
    });
});

// ============================================================
// MANUTENÇÃO AUTOMÁTICA
// ============================================================

// Limpar dados com mais de 60 dias
setInterval(() => {
    const dataLimite = new Date(getDataHoraBrasil());
    dataLimite.setDate(dataLimite.getDate() - 60);
    const dataLimiteStr = formatarDataHoraSQL(dataLimite);

    db.run("DELETE FROM pesos WHERE data < ?", [dataLimiteStr], function(err) {
        if (!err && this.changes > 0) {
            console.log(`🧹 Limpeza automática: ${this.changes} registros antigos removidos`);
        }
    });
}, 24 * 60 * 60 * 1000);

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
    console.log("🚀 PetFlow Backend v2.0");
    console.log("========================================");
    console.log(`🕐 Horário do servidor: ${formatarDataHoraExibicao(getDataHoraBrasil())}`);
    console.log(`📡 Dashboard: http://${getLocalIp()}:${PORT}`);
    console.log(`🔗 API: http://${getLocalIp()}:${PORT}/api`);
    console.log("========================================\n");
});
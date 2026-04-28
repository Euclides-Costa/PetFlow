const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ============================================================
// BANCO DE DADOS
// ============================================================
const db = new sqlite3.Database("pesos.db");

// Criar tabela principal
db.run(`
    CREATE TABLE IF NOT EXISTS pesos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        valor REAL,
        data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Criar tabela de configurações (com verificação)
db.run(`
    CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.log("⚠️ Tabela config já existe ou erro:", err.message);
    } else {
        console.log("✅ Tabela config criada com sucesso");
        // Inserir configurações padrão
        db.run(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('alerta_horas', '8')`);
        db.run(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('limite_maximo_kg', '5')`);
        db.run(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('filtro_leituras', '5')`);
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

// 📡 Receber dados do ESP32 (com validação)
app.post("/peso", (req, res) => {
    let { peso } = req.body;

    // Validar peso
    if (peso === undefined || peso === null) {
        return res.status(400).json({ error: "Peso não informado" });
    }

    peso = parseFloat(peso);

    // Ignorar valores negativos
    if (peso < 0) {
        console.log(`⚠️ Valor negativo ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "negative value", peso: peso });
    }

    // Limitar a 10kg máximo (evitar picos)
    if (peso > 10) {
        console.log(`⚠️ Valor muito alto ignorado: ${peso} kg`);
        return res.json({ status: "ignored", reason: "value too high", peso: peso });
    }

    console.log(`📊 Peso salvo: ${peso.toFixed(3)} kg - ${new Date().toLocaleTimeString()}`);

    db.run("INSERT INTO pesos (valor) VALUES (?)", [peso], function(err) {
        if (err) {
            console.error("Erro ao salvar:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json({
            status: "ok",
            id: this.lastID,
            peso: peso,
            timestamp: new Date().toISOString()
        });
    });
});

// 📊 Histórico completo (apenas valores válidos)
app.get("/pesos", (req, res) => {
    const { limite = 500 } = req.query;
    db.all(
        "SELECT * FROM pesos WHERE valor >= 0 ORDER BY data DESC LIMIT ?",
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

// 📅 Histórico com filtro de data (para o dashboard)
app.get("/pesos/filtro", (req, res) => {
    let { inicio, fim, limite = 1000 } = req.query;
    let query = "SELECT * FROM pesos WHERE valor >= 0";
    let params = [];

    if (inicio) {
        query += " AND data >= ?";
        params.push(inicio);
    }
    if (fim) {
        query += " AND data <= ?";
        params.push(fim + " 23:59:59");
    }

    query += " ORDER BY data DESC LIMIT ?";
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
            groupBy = "strftime('%Y-%m-%d %H:00:00', data)";
            break;
        case "dia":
            groupBy = "DATE(data)";
            break;
        case "semana":
            groupBy = "strftime('%Y-%W', data)";
            break;
        case "mes":
            groupBy = "strftime('%Y-%m', data)";
            break;
        default:
            groupBy = "DATE(data)";
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
        query += " AND data >= ?";
        params.push(inicio);
    }
    if (fim) {
        query += " AND data <= ?";
        params.push(fim + " 23:59:59");
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

// 🍖 Consumo total (soma das variações de peso)
app.get("/consumo/total", (req, res) => {
    let { inicio, fim } = req.query;
    let query = "SELECT valor, data FROM pesos WHERE valor >= 0 ORDER BY data ASC";
    let params = [];

    if (inicio) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND data >= ? ORDER BY data ASC";
        params.push(inicio);
    }
    if (fim && params.length > 0) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND data >= ? AND data <= ? ORDER BY data ASC";
        params.push(fim + " 23:59:59");
    } else if (fim) {
        query = "SELECT valor, data FROM pesos WHERE valor >= 0 AND data <= ? ORDER BY data ASC";
        params.push(fim + " 23:59:59");
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Calcular consumo total (soma das reduções de peso)
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
    db.all(`
        SELECT 
            DATE(data) as dia,
            SUM(CASE WHEN valor > 0 THEN valor ELSE 0 END) as total,
            COUNT(*) as leituras,
            MIN(valor) as minimo,
            MAX(valor) as maximo
        FROM pesos
        WHERE DATE(data) = DATE('now') AND valor >= 0
        GROUP BY DATE(data)
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📆 Consumo da semana
app.get("/consumo/semana", (req, res) => {
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
        WHERE DATE(data) >= DATE('now', '-7 days') AND valor >= 0
        GROUP BY dia_semana
        ORDER BY dia_semana
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📅 Consumo do mês (últimos 30 dias)
app.get("/consumo/mes", (req, res) => {
    db.all(`
        SELECT 
            strftime('%W', data) as semana,
            'Semana ' || (strftime('%W', data) - strftime('%W', DATE('now', '-30 days')) + 1) as nome_semana,
            SUM(valor) as total,
            AVG(valor) as media,
            COUNT(*) as leituras,
            MIN(valor) as minimo,
            MAX(valor) as maximo
        FROM pesos
        WHERE DATE(data) >= DATE('now', '-30 days') AND valor >= 0
        GROUP BY semana
        ORDER BY semana
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 📊 Dashboard resumo completo
app.get("/dashboard", (req, res) => {
    db.get(`
        SELECT 
            COALESCE((SELECT SUM(valor) FROM pesos WHERE DATE(data) = DATE('now') AND valor >= 0), 0) as consumo_hoje,
            COALESCE((SELECT SUM(valor) FROM pesos WHERE DATE(data) >= DATE('now', '-7 days') AND valor >= 0), 0) as consumo_semana,
            COALESCE((SELECT SUM(valor) FROM pesos WHERE DATE(data) >= DATE('now', '-30 days') AND valor >= 0), 0) as consumo_mes,
            COALESCE((SELECT COUNT(*) FROM pesos WHERE valor >= 0), 0) as total_leituras,
            COALESCE((SELECT valor FROM pesos WHERE valor >= 0 ORDER BY data DESC LIMIT 1), 0) as ultimo_peso,
            (SELECT data FROM pesos WHERE valor >= 0 ORDER BY data DESC LIMIT 1) as ultima_atualizacao,
            COALESCE((SELECT AVG(valor) FROM pesos WHERE DATE(data) >= DATE('now', '-7 days') AND valor >= 0), 0) as media_7dias,
            COALESCE((SELECT COUNT(*) FROM pesos WHERE DATE(data) = DATE('now') AND valor >= 0), 0) as leituras_hoje
    `, [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row);
    });
});

// 📈 Estatísticas avançadas
app.get("/estatisticas", (req, res) => {
    db.get(`
        SELECT 
            COALESCE(MIN(valor), 0) as peso_minimo,
            COALESCE(MAX(valor), 0) as peso_maximo,
            COALESCE(AVG(valor), 0) as peso_medio,
            COUNT(*) as total_leituras,
            SUM(CASE WHEN valor < 0.1 THEN 1 ELSE 0 END) as leituras_vazio,
            SUM(CASE WHEN valor > 1 THEN 1 ELSE 0 END) as leituras_acima_1kg,
            (SELECT valor FROM pesos ORDER BY data DESC LIMIT 1) as ultimo_peso,
            (SELECT data FROM pesos ORDER BY data DESC LIMIT 1) as ultima_leitura
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

// ⚙️ Configurações do sistema (com fallback)
app.get("/config", (req, res) => {
    // Verificar se tabela config existe
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='config'", [], (err, tableExists) => {
        if (err || !tableExists) {
            // Retornar configurações padrão se tabela não existir
            return res.json({
                alerta_horas: "8",
                limite_maximo_kg: "5",
                filtro_leituras: "5",
                modo_offline: "false"
            });
        }

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
});

app.put("/config/:chave", (req, res) => {
    const { chave } = req.params;
    const { valor } = req.body;

    db.run(
        "INSERT OR REPLACE INTO config (chave, valor, data_atualizacao) VALUES (?, ?, CURRENT_TIMESTAMP)",
        [chave, valor],
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

    db.run(
        "DELETE FROM pesos WHERE data < datetime('now', ?) AND valor >= 0",
        [`-${dias} days`],
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

// 📤 Exportar dados em CSV
app.get("/exportar/csv", (req, res) => {
    let { inicio, fim } = req.query;
    let query = "SELECT id, valor, data FROM pesos WHERE valor >= 0";
    let params = [];

    if (inicio) {
        query += " AND data >= ?";
        params.push(inicio);
    }
    if (fim) {
        query += " AND data <= ?";
        params.push(fim + " 23:59:59");
    }
    query += " ORDER BY data DESC";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        let csv = "id,peso_kg,data_hora\n";
        rows.forEach(row => {
            csv += `${row.id},${row.valor},${row.data}\n`;
        });

        res.header("Content-Type", "text/csv");
        res.attachment(`petflow_dados_${new Date().toISOString().slice(0,19)}.csv`);
        res.send(csv);
    });
});

// 📤 Exportar dados em JSON
app.get("/exportar/json", (req, res) => {
    let { inicio, fim } = req.query;
    let query = "SELECT * FROM pesos WHERE valor >= 0";
    let params = [];

    if (inicio) {
        query += " AND data >= ?";
        params.push(inicio);
    }
    if (fim) {
        query += " AND data <= ?";
        params.push(fim + " 23:59:59");
    }
    query += " ORDER BY data DESC";

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        res.json({
            exportado_em: new Date().toISOString(),
            total_registros: rows.length,
            dados: rows
        });
    });
});

// 🔔 Verificar alertas (8h sem consumo)
app.get("/alertas/verificar", (req, res) => {
    db.get(`
        SELECT 
            MAX(data) as ultima_vez,
            MAX(CASE 
                WHEN valor > 0.05 THEN data 
                ELSE NULL 
            END) as ultimo_consumo
        FROM pesos 
        WHERE valor >= 0 AND data >= datetime('now', '-8 hours')
    `, [], (err, row) => {
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

// 🏠 Rota raiz - Documentação da API
app.get("/", (req, res) => {
    res.json({
        nome: "PetFlow API",
        versao: "2.0.0",
        descricao: "API para monitoramento inteligente de alimentação de pets",
        endpoints: {
            dados: {
                "POST /peso": "Enviar peso do ESP32",
                "GET /pesos": "Listar histórico (últimos 500)",
                "GET /pesos/filtro": "Histórico com filtro de data",
                "GET /dashboard": "Resumo do dashboard",
                "GET /estatisticas": "Estatísticas avançadas"
            },
            consumo: {
                "GET /consumo/dia": "Consumo do dia",
                "GET /consumo/semana": "Consumo da semana",
                "GET /consumo/mes": "Consumo do mês",
                "GET /consumo/periodo": "Consumo por período personalizado",
                "GET /consumo/total": "Consumo total no período"
            },
            exportacao: {
                "GET /exportar/csv": "Exportar dados em CSV",
                "GET /exportar/json": "Exportar dados em JSON"
            },
            config: {
                "GET /config": "Configurações do sistema",
                "PUT /config/:chave": "Atualizar configuração"
            },
            alertas: {
                "GET /alertas/verificar": "Verificar alertas de alimentação"
            },
            manutencao: {
                "DELETE /dados/limpar?dias=30": "Limpar dados antigos"
            }
        },
        status: "online",
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// MANUTENÇÃO AUTOMÁTICA
// ============================================================

// Limpar dados com mais de 60 dias (executar a cada 24h)
setInterval(() => {
    db.run("DELETE FROM pesos WHERE data < datetime('now', '-60 days')", function(err) {
        if (!err && this.changes > 0) {
            console.log(`🧹 Limpeza automática: ${this.changes} registros antigos removidos`);
        }
    });
}, 24 * 60 * 60 * 1000);

// Log de status a cada hora
setInterval(() => {
    db.get("SELECT COUNT(*) as total FROM pesos WHERE valor >= 0", [], (err, row) => {
        if (!err) {
            console.log(`📊 Status: ${row?.total || 0} registros no banco - ${new Date().toLocaleString()}`);
        }
    });
}, 60 * 60 * 1000);

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("\n========================================");
    console.log("🚀 PetFlow Backend v2.0");
    console.log("========================================");
    console.log(`📡 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🌐 Na rede: http://${getLocalIp()}:${PORT}`);
    console.log("========================================");
    console.log("📋 Endpoints disponíveis:");
    console.log("   GET  /            - Documentação");
    console.log("   POST /peso        - Enviar peso");
    console.log("   GET  /pesos       - Histórico");
    console.log("   GET  /dashboard   - Dashboard");
    console.log("   GET  /exportar/csv - Exportar CSV");
    console.log("========================================\n");
});

// Função para obter IP local
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
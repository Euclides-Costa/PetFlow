const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'pesos.db'));

console.log('\n========================================');
console.log('📊 CONSULTANDO BANCO DE DADOS');
console.log('========================================\n');

// Verificar se a tabela existe
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pesos'", [], (err, table) => {
    if (err) {
        console.error('❌ Erro ao verificar tabela:', err.message);
        db.close();
        return;
    }

    if (!table) {
        console.log('❌ Tabela "pesos" não encontrada!');
        console.log('O backend ainda não recebeu nenhum dado.');
        db.close();
        return;
    }

    // Total de registros
    db.get("SELECT COUNT(*) as total FROM pesos", [], (err, row) => {
        if (err) {
            console.error('Erro:', err);
            db.close();
            return;
        }

        const totalRegistros = row?.total || 0;
        console.log(`📈 Total de registros: ${totalRegistros}`);

        if (totalRegistros === 0) {
            console.log('\n❌ Nenhum registro encontrado no banco!');
            console.log('Aguardando dados do ESP32...');
            console.log('\n========================================\n');
            db.close();
            return;
        }

        // Últimos 10 registros
        db.all("SELECT * FROM pesos ORDER BY data DESC LIMIT 10", [], (err, rows) => {
            if (err) {
                console.error('Erro:', err);
                db.close();
                return;
            }

            console.log('\n📋 ÚLTIMOS 10 REGISTROS:');
            console.log('----------------------------------------');

            rows.forEach(row => {
                const data = new Date(row.data).toLocaleString('pt-BR');
                console.log(`ID: ${row.id.toString().padStart(3)} | Peso: ${row.valor.toFixed(3)} kg | Data: ${data}`);
            });

            // Estatísticas gerais
            db.get(`
                SELECT 
                    MIN(valor) as minimo,
                    MAX(valor) as maximo,
                    AVG(valor) as medio,
                    COUNT(*) as total,
                    SUM(CASE WHEN valor > 0 THEN 1 ELSE 0 END) as positivos,
                    MAX(data) as ultima_data
                FROM pesos 
            `, [], (err, stats) => {
                if (err) {
                    console.error('Erro:', err);
                    db.close();
                    return;
                }

                console.log('\n📊 ESTATÍSTICAS GERAIS:');
                console.log('----------------------------------------');
                console.log(`📉 Peso mínimo: ${stats?.minimo?.toFixed(3) || 0} kg`);
                console.log(`📈 Peso máximo: ${stats?.maximo?.toFixed(3) || 0} kg`);
                console.log(`📊 Peso médio: ${stats?.medio?.toFixed(3) || 0} kg`);
                console.log(`✅ Leituras válidas: ${stats?.positivos || 0}`);

                if (stats?.ultima_data) {
                    const ultimaData = new Date(stats.ultima_data).toLocaleString('pt-BR');
                    console.log(`⏱️  Última leitura: ${ultimaData}`);
                }

                // Dados de hoje
                db.get(`
                    SELECT COUNT(*) as hoje, SUM(valor) as total_hoje
                    FROM pesos 
                    WHERE DATE(data) = DATE('now')
                `, [], (err, hoje) => {
                    if (!err && hoje?.hoje > 0) {
                        console.log('\n📅 DADOS DE HOJE:');
                        console.log('----------------------------------------');
                        console.log(`📊 Leituras hoje: ${hoje.hoje}`);
                        console.log(`🍖 Consumo hoje: ${(hoje.total_hoje || 0).toFixed(3)} kg`);
                    }

                    console.log('\n========================================\n');
                    db.close();
                });
            });
        });
    });
});